import { Request, Response }           from "express";
import { z }                           from "zod";
import { prisma }                      from "../lib/prisma";
import { logUserEvent, logSystemEvent } from "../lib/auditService";
import { BookingStatus, DurationType } from "@prisma/client";
import crypto                          from "crypto";

// ─────────────────────────────────────────────────────────────────────────────
//  bookingControllers.ts
//
//  Short stay booking system for AskDerek.
//
//  Business rules enforced:
//    — Guest cannot book their own property
//    — Cannot double book — overlap check on every new booking
//    — Minimum booking duration is 1 hour
//    — Cancellation only allowed before check in time
//    — Check in only allowed on CONFIRMED bookings
//    — Check out only allowed on CHECKED_IN bookings
//    — Price calculated from PaymentStructure — not from request body
//    — Reference generated server side — never trusted from client
//    — All status transitions validated before database write
//    — Audit log fires after transaction — never inside
// ─────────────────────────────────────────────────────────────────────────────

// ── RESPONSE TYPES ────────────────────────────────────────────────────────────

interface ApiSuccess<T = unknown> {
  success: true;
  message: string;
  data?:   T;
}

interface ApiError {
  success: false;
  message: string;
  errors?: { field: string; message: string }[];
}

type ApiResponse<T = unknown> = ApiSuccess<T> | ApiError;

// ── VALIDATION SCHEMAS ────────────────────────────────────────────────────────

const createBookingSchema = z.object({
  propertyId:   z.number({ error: "propertyId must be a number" })
                 .int()
                 .positive(),
  checkIn:      z.string({ error: "checkIn is required" })
                 .datetime({ message: "checkIn must be a valid ISO datetime" }),
  checkOut:     z.string({ error: "checkOut is required" })
                 .datetime({ message: "checkOut must be a valid ISO datetime" }),
  durationType: z.enum([
    "HOURLY",
    "DAILY",
    "WEEKLY",
    "MONTHLY",
  ], { error: "durationType must be HOURLY, DAILY, WEEKLY or MONTHLY" }),
});

const cancelBookingSchema = z.object({
  reason: z.string()
           .min(5,   "Cancellation reason must be at least 5 characters")
           .max(500, "Cancellation reason cannot exceed 500 characters")
           .optional(),
});

// ── SHARED HELPERS ────────────────────────────────────────────────────────────

// Extracts userId from verified Clerk JWT.
// Identity must always come from the token — never from req.body.
const requireAuth = (req: Request, res: Response): string | null => {
  const userId = req.auth?.userId;
  if (!userId) {
    res.status(401).json({ success: false, message: "Unauthorized" });
    return null;
  }
  return userId;
};

// Verifies caller is an active admin via database check.
// JWT alone is not trusted for admin actions.
const requireAdminAuth = async (
  req: Request,
  res: Response
): Promise<string | null> => {
  const userId = req.auth?.userId;
  if (!userId) {
    res.status(401).json({ success: false, message: "Unauthorized" });
    return null;
  }
  const user = await prisma.user.findUnique({
    where:  { clerkId: userId },
    select: { role: true, isActive: true },
  });
  if (!user || user.role !== "ADMIN" || !user.isActive) {
    res.status(403).json({ success: false, message: "Forbidden" });
    return null;
  }
  return userId;
};

// Validates a numeric route parameter.
const getNumericParam = (
  value: string,
  name:  string,
  res:   Response
): number | null => {
  const id = Number(value);
  if (isNaN(id) || id <= 0) {
    res.status(400).json({ success: false, message: `Invalid ${name}` });
    return null;
  }
  return id;
};

// Converts Zod issues to the standard API error shape.
const formatZodErrors = (
  issues: z.ZodIssue[]
): { field: string; message: string }[] =>
  issues.map(i => ({
    field:   String(i.path[0] ?? "unknown"),
    message: i.message,
  }));

// Generates a unique booking reference — server side only.
// Format: BK-YYYY-XXXXXXXX
// Never accepted from client input — prevents reference manipulation.
const generateBookingReference = (): string => {
  const year = new Date().getFullYear();
  const hex  = crypto.randomBytes(4).toString("hex").toUpperCase();
  return `BK-${year}-${hex}`;
};

// Calculates total booking amount from PaymentStructure database price.
// Price always comes from the database — never from request body.
// Throws on unknown durationType — prevents silent GHS 0 bookings.
const calculateBookingAmount = (
  checkIn:      Date,
  checkOut:     Date,
  durationType: string,
  pricePerUnit: number
): number => {
  const diffMs     = checkOut.getTime() - checkIn.getTime();
  const diffHours  = diffMs / (1000 * 60 * 60);
  const diffDays   = diffHours / 24;
  const diffWeeks  = diffDays / 7;
  const diffMonths = diffDays / 30;

  switch (durationType) {
    case "HOURLY":  return Math.ceil(diffHours)  * pricePerUnit;
    case "DAILY":   return Math.ceil(diffDays)   * pricePerUnit;
    case "WEEKLY":  return Math.ceil(diffWeeks)  * pricePerUnit;
    case "MONTHLY": return Math.ceil(diffMonths) * pricePerUnit;
    default:
      throw new Error(`Unknown durationType: ${durationType}`);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
//  CREATE BOOKING
//  POST /api/bookings
//
//  Guest creates a short stay booking.
//
//  Edge cases handled:
//    — Cannot book own property
//    — Property must be SHORT_STAY and AVAILABLE
//    — checkIn must be in the future
//    — checkOut must be after checkIn
//    — Minimum 1 hour booking duration
//    — No date overlap with existing confirmed/active bookings
//    — Price from database PaymentStructure — never from body
//    — Audit log fires after transaction — not inside
// ─────────────────────────────────────────────────────────────────────────────
export const createBooking = async (
  req: Request,
  res: Response<ApiResponse>
): Promise<void> => {
  const guestClerkId = requireAuth(req, res);
  if (!guestClerkId) return;

  const parsed = createBookingSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      success: false,
      message: "Validation failed",
      errors:  formatZodErrors(parsed.error.issues),
    });
    return;
  }

  const { propertyId, checkIn, checkOut, durationType } = parsed.data;

  const checkInDate  = new Date(checkIn);
  const checkOutDate = new Date(checkOut);
  const now          = new Date();

  // checkIn must be in the future
  if (checkInDate <= now) {
    res.status(400).json({
      success: false,
      message: "Check in time must be in the future",
    });
    return;
  }

  // checkOut must be after checkIn
  if (checkOutDate <= checkInDate) {
    res.status(400).json({
      success: false,
      message: "Check out must be after check in",
    });
    return;
  }

  // Minimum 1 hour booking duration
  const diffMs    = checkOutDate.getTime() - checkInDate.getTime();
  const diffHours = diffMs / (1000 * 60 * 60);

  if (diffHours < 1) {
    res.status(400).json({
      success: false,
      message: "Minimum booking duration is 1 hour",
    });
    return;
  }

  try {
    // Fetch property with matching payment structure in one query — no N+1
    const property = await prisma.property.findFirst({
      where: {
        id:            propertyId,
        listingType:   "SHORT_STAY",
        listingStatus: "AVAILABLE",
        deletedAt:     null,
        isArchived:    false,
      },
      include: {
        structures: {
          where: {
            durationType: durationType as DurationType,
            isActive:     true,
          },
        },
      },
    });

    if (!property) {
      res.status(404).json({
        success: false,
        message: "Property not found or not available for short stay booking",
      });
      return;
    }

    // Cannot book own property
    if (property.managerClerkId === guestClerkId) {
      res.status(400).json({
        success: false,
        message: "You cannot book your own property",
      });
      return;
    }

    // Verify pricing exists for the selected duration type
    const priceStructure = property.structures[0];
    if (!priceStructure) {
      res.status(400).json({
        success: false,
        message: `This property does not offer ${durationType} pricing`,
      });
      return;
    }

    // Overlap check — prevent double bookings on same property same dates
    const overlapping = await prisma.booking.findFirst({
      where: {
        propertyId,
        status: { in: [BookingStatus.CONFIRMED, BookingStatus.CHECKED_IN] },
        AND: [
          { checkIn:  { lt: checkOutDate } },
          { checkOut: { gt: checkInDate  } },
        ],
      },
    });

    if (overlapping) {
      res.status(400).json({
        success: false,
        message: "This property is already booked for the selected dates",
      });
      return;
    }

    // Calculate total from database price — never from request body
    const totalAmount = calculateBookingAmount(
      checkInDate,
      checkOutDate,
      durationType,
      priceStructure.price
    );

    // Create booking in transaction — atomic operation
    const booking = await prisma.$transaction(async (tx) => {
      return await tx.booking.create({
        data: {
          propertyId,
          guestClerkId,
          checkIn:      checkInDate,
          checkOut:     checkOutDate,
          totalAmount,
          durationType: durationType as DurationType,
          status:       BookingStatus.CONFIRMED,
          reference:    generateBookingReference(),
        },
      });
    });

    // Audit log fires AFTER transaction — not inside it
    // This prevents partial audit logs if the transaction rolls back
    await logUserEvent({
      userClerkId: guestClerkId,
      action:      "BOOKING_CREATED",
      target:      `Booking #${booking.id} — Property #${propertyId}`,
      details:     `Check in: ${checkIn}. Check out: ${checkOut}. Total: GHS ${totalAmount}`,
    });

    res.status(201).json({
      success: true,
      message: "Booking confirmed successfully",
      data: {
        booking,
        totalAmount,
        pricePerUnit: priceStructure.price,
        durationType,
      },
    });
  } catch (error) {
    console.error("[bookingControllers.createBooking]", {
      propertyId,
      guestClerkId,
      error: error instanceof Error ? error.message : error,
    });
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
//  CANCEL BOOKING
//  PUT /api/bookings/:bookingId/cancel
//
//  Guest cancels a booking before check in.
//  Cancellation not allowed after check in has occurred.
//  Only the guest who created the booking can cancel it.
// ─────────────────────────────────────────────────────────────────────────────
export const cancelBooking = async (
  req: Request,
  res: Response<ApiResponse>
): Promise<void> => {
  const guestClerkId = requireAuth(req, res);
  if (!guestClerkId) return;

  const bookingId = getNumericParam(req.params.bookingId, "bookingId", res);
  if (!bookingId) return;

  const parsed = cancelBookingSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      success: false,
      message: "Validation failed",
      errors:  formatZodErrors(parsed.error.issues),
    });
    return;
  }

  try {
    // Authorization — only the guest who created it can cancel
    const booking = await prisma.booking.findFirst({
      where: { id: bookingId, guestClerkId },
    });

    if (!booking) {
      res.status(404).json({
        success: false,
        message: "Booking not found or you do not have permission",
      });
      return;
    }

    // Status guard — cannot cancel after check in or if already cancelled
    if (
      booking.status === BookingStatus.CHECKED_IN  ||
      booking.status === BookingStatus.CHECKED_OUT ||
      booking.status === BookingStatus.CANCELLED
    ) {
      res.status(400).json({
        success: false,
        message: `Cannot cancel a booking with status: ${booking.status}`,
      });
      return;
    }

    await prisma.booking.update({
      where: { id: bookingId },
      data:  { status: BookingStatus.CANCELLED },
    });

    await logUserEvent({
      userClerkId: guestClerkId,
      action:      "BOOKING_CANCELLED",
      target:      `Booking #${bookingId}`,
      details:     `Cancelled by guest. Reason: ${parsed.data.reason ?? "No reason given"}`,
    });

    res.status(200).json({
      success: true,
      message: "Booking cancelled successfully",
    });
  } catch (error) {
    console.error("[bookingControllers.cancelBooking]", {
      bookingId,
      guestClerkId,
      error: error instanceof Error ? error.message : error,
    });
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
//  CHECK IN
//  PUT /api/bookings/:bookingId/checkin
//
//  Manager confirms guest has arrived at property.
//  Only allowed on CONFIRMED bookings.
//  Only the property manager can confirm check in.
//  include removed — property relation fetched in where clause only.
// ─────────────────────────────────────────────────────────────────────────────
export const checkIn = async (
  req: Request,
  res: Response<ApiResponse>
): Promise<void> => {
  const managerClerkId = requireAuth(req, res);
  if (!managerClerkId) return;

  const bookingId = getNumericParam(req.params.bookingId, "bookingId", res);
  if (!bookingId) return;

  try {
    // Authorization — manager must own the property for this booking
    const booking = await prisma.booking.findFirst({
      where: {
        id:       bookingId,
        property: { managerClerkId },
      },
    });

    if (!booking) {
      res.status(404).json({
        success: false,
        message: "Booking not found or you do not have permission",
      });
      return;
    }

    if (booking.status !== BookingStatus.CONFIRMED) {
      res.status(400).json({
        success: false,
        message: `Cannot check in a booking with status: ${booking.status}`,
      });
      return;
    }

    await prisma.booking.update({
      where: { id: bookingId },
      data:  { status: BookingStatus.CHECKED_IN },
    });

    await logSystemEvent({
      action:  "BOOKING_CHECKED_IN",
      target:  `Booking #${bookingId}`,
      details: `Guest checked in. Property #${booking.propertyId}`,
    });

    res.status(200).json({
      success: true,
      message: "Guest checked in successfully",
    });
  } catch (error) {
    console.error("[bookingControllers.checkIn]", {
      bookingId,
      managerClerkId,
      error: error instanceof Error ? error.message : error,
    });
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
//  CHECK OUT
//  PUT /api/bookings/:bookingId/checkout
//
//  Manager confirms guest has vacated the property.
//  Only allowed on CHECKED_IN bookings.
//  Only the property manager can confirm check out.
// ─────────────────────────────────────────────────────────────────────────────
export const checkOut = async (
  req: Request,
  res: Response<ApiResponse>
): Promise<void> => {
  const managerClerkId = requireAuth(req, res);
  if (!managerClerkId) return;

  const bookingId = getNumericParam(req.params.bookingId, "bookingId", res);
  if (!bookingId) return;

  try {
    const booking = await prisma.booking.findFirst({
      where: {
        id:       bookingId,
        property: { managerClerkId },
      },
    });

    if (!booking) {
      res.status(404).json({
        success: false,
        message: "Booking not found or you do not have permission",
      });
      return;
    }

    if (booking.status !== BookingStatus.CHECKED_IN) {
      res.status(400).json({
        success: false,
        message: `Cannot check out a booking with status: ${booking.status}`,
      });
      return;
    }

    await prisma.booking.update({
      where: { id: bookingId },
      data:  { status: BookingStatus.CHECKED_OUT },
    });

    await logSystemEvent({
      action:  "BOOKING_CHECKED_OUT",
      target:  `Booking #${bookingId}`,
      details: `Guest checked out. Property #${booking.propertyId}`,
    });

    res.status(200).json({
      success: true,
      message: "Guest checked out successfully",
    });
  } catch (error) {
    console.error("[bookingControllers.checkOut]", {
      bookingId,
      managerClerkId,
      error: error instanceof Error ? error.message : error,
    });
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
//  GET GUEST BOOKINGS
//  GET /api/bookings/my
//
//  Returns all bookings made by the logged-in guest.
//  Includes property name and location for display.
//  Ordered by check in date — most recent first.
// ─────────────────────────────────────────────────────────────────────────────
export const getGuestBookings = async (
  req: Request,
  res: Response<ApiResponse>
): Promise<void> => {
  const guestClerkId = requireAuth(req, res);
  if (!guestClerkId) return;

  try {
    const bookings = await prisma.booking.findMany({
      where:   { guestClerkId },
      include: {
        property: {
          select: {
            id:        true,
            name:      true,
            photoUrls: true,
            location: {
              select: {
                city:   true,
                region: true,
              },
            },
          },
        },
      },
      orderBy: { checkIn: "desc" },
    });

    res.status(200).json({
      success: true,
      message: "Bookings retrieved successfully",
      data:    bookings,
    });
  } catch (error) {
    console.error("[bookingControllers.getGuestBookings]", {
      guestClerkId,
      error: error instanceof Error ? error.message : error,
    });
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
//  GET PROPERTY BOOKINGS — MANAGER
//  GET /api/bookings/property/:propertyId
//
//  Returns all bookings for a specific property.
//  Only the manager who owns the property can view.
// ─────────────────────────────────────────────────────────────────────────────
export const getPropertyBookings = async (
  req: Request,
  res: Response<ApiResponse>
): Promise<void> => {
  const managerClerkId = requireAuth(req, res);
  if (!managerClerkId) return;

  const propertyId = getNumericParam(req.params.propertyId, "propertyId", res);
  if (!propertyId) return;

  try {
    // Authorization — confirm manager owns this property
    const property = await prisma.property.findFirst({
      where: {
        id:            propertyId,
        managerClerkId,
        deletedAt:     null,
      },
    });

    if (!property) {
      res.status(404).json({
        success: false,
        message: "Property not found or you do not have permission",
      });
      return;
    }

    const bookings = await prisma.booking.findMany({
      where:   { propertyId },
      orderBy: { checkIn: "desc" },
    });

    res.status(200).json({
      success: true,
      message: "Property bookings retrieved successfully",
      data:    bookings,
    });
  } catch (error) {
    console.error("[bookingControllers.getPropertyBookings]", {
      propertyId,
      managerClerkId,
      error: error instanceof Error ? error.message : error,
    });
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
//  GET ALL BOOKINGS — ADMIN
//  GET /api/bookings/admin/all
//
//  Returns all bookings platform wide — Derek only.
//  Paginated — prevents memory overload as platform scales.
//  Both queries run in parallel — faster response time.
// ─────────────────────────────────────────────────────────────────────────────
export const getAllBookings = async (
  req: Request,
  res: Response<ApiResponse>
): Promise<void> => {
  const adminClerkId = await requireAdminAuth(req, res);
  if (!adminClerkId) return;

  const page  = Math.max(1,  Number(req.query.page)  || 1);
  const limit = Math.min(50, Number(req.query.limit)  || 20);
  const skip  = (page - 1) * limit;

  try {
    const [bookings, total] = await Promise.all([
      prisma.booking.findMany({
        skip,
        take: limit,
        include: {
          property: {
            select: {
              id:             true,
              name:           true,
              managerClerkId: true,
            },
          },
        },
        orderBy: { createdAt: "desc" },
      }),
      prisma.booking.count(),
    ]);

    res.status(200).json({
      success: true,
      message: "All bookings retrieved",
      data: {
        bookings,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      },
    });
  } catch (error) {
    console.error("[bookingControllers.getAllBookings]", {
      adminClerkId,
      error: error instanceof Error ? error.message : error,
    });
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
//  MARK NO SHOW
//  PUT /api/bookings/:bookingId/no-show
//
//  Manager marks a booking as NO_SHOW when guest did not arrive.
//  Only valid for CONFIRMED bookings past the check in time.
//  Only the property manager can mark no-show.
// ─────────────────────────────────────────────────────────────────────────────
export const markNoShow = async (
  req: Request,
  res: Response<ApiResponse>
): Promise<void> => {
  const managerClerkId = requireAuth(req, res);
  if (!managerClerkId) return;

  const bookingId = getNumericParam(req.params.bookingId, "bookingId", res);
  if (!bookingId) return;

  try {
    const booking = await prisma.booking.findFirst({
      where: {
        id:       bookingId,
        property: { managerClerkId },
      },
    });

    if (!booking) {
      res.status(404).json({
        success: false,
        message: "Booking not found or you do not have permission",
      });
      return;
    }

    if (booking.status !== BookingStatus.CONFIRMED) {
      res.status(400).json({
        success: false,
        message: `Cannot mark no-show for booking with status: ${booking.status}`,
      });
      return;
    }

    // Can only mark no-show after the check in time has passed
    if (new Date() <= booking.checkIn) {
      res.status(400).json({
        success: false,
        message: "Cannot mark no-show before the check in time has passed",
      });
      return;
    }

    await prisma.booking.update({
      where: { id: bookingId },
      data:  { status: BookingStatus.NO_SHOW },
    });

    await logSystemEvent({
      action:  "BOOKING_NO_SHOW",
      target:  `Booking #${bookingId}`,
      details: `Marked no-show by manager ${managerClerkId}. Property #${booking.propertyId}`,
    });

    res.status(200).json({
      success: true,
      message: "Booking marked as no-show",
    });
  } catch (error) {
    console.error("[bookingControllers.markNoShow]", {
      bookingId,
      managerClerkId,
      error: error instanceof Error ? error.message : error,
    });
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};