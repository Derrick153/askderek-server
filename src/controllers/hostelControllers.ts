// ─────────────────────────────────────────────────────────────────────────────
//  hostelControllers.ts
//
//  Hostel booking system for AskDerek.
//
//  Business rules enforced:
//    — Student cannot book their own hostel
//    — Cannot double book same room same semester
//    — FIXED closingType requires fixedEndDate
//    — SCHOOL_CALENDAR closingType requires schoolId and school must exist
//    — OPEN_ENDED closingType — student checks out when ready
//    — Price from PaymentStructure — never from request body
//    — Reference generated server side — never trusted from client
//    — Ownership verified via two-step query — semesterPlan + property
//    — Audit log fires after transaction — never inside
//    — Admin role verified from database on every admin request
// ─────────────────────────────────────────────────────────────────────────────

import { Request, Response }               from "express";
import { z }                               from "zod";
import { prisma }                          from "../lib/prisma";
import { logUserEvent, logSystemEvent }    from "../lib/auditService";
import { ClosingType, HostelBookingStatus } from "@prisma/client";
import crypto                              from "crypto";

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

const createSemesterBookingSchema = z.object({
  propertyId:   z.number({ error: "propertyId must be a number" })
                 .int()
                 .positive(),
  semesterName: z.string()
                 .min(3,   "semesterName must be at least 3 characters")
                 .max(100, "semesterName cannot exceed 100 characters"),
  checkIn:      z.string()
                 .datetime({ message: "checkIn must be a valid ISO datetime" }),
  closingType:  z.enum(["FIXED", "SCHOOL_CALENDAR", "OPEN_ENDED"], {
    error: "closingType must be FIXED, SCHOOL_CALENDAR or OPEN_ENDED",
  }),
  fixedEndDate: z.string()
                 .datetime({ message: "fixedEndDate must be a valid ISO datetime" })
                 .optional(),
  schoolId:     z.number({ error: "schoolId must be a number" })
                 .int()
                 .positive()
                 .optional(),
  roomNumber:   z.string()
                 .max(20, "roomNumber cannot exceed 20 characters")
                 .optional(),
});

const checkoutStudentSchema = z.object({
  actualEndDate: z.string()
                  .datetime({ message: "actualEndDate must be a valid ISO datetime" }),
});

const extendStaySchema = z.object({
  newEndDate: z.string()
               .datetime({ message: "newEndDate must be a valid ISO datetime" }),
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
// Returns null and sends 400 if value is not a valid positive integer.
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

// Generates a unique hostel booking reference — server side only.
// Format: HST-YYYY-XXXXXXXX
// Never accepted from client input — prevents reference manipulation.
const generateHostelReference = (): string => {
  const year = new Date().getFullYear();
  const hex  = crypto.randomBytes(4).toString("hex").toUpperCase();
  return `HST-${year}-${hex}`;
};

// ─────────────────────────────────────────────────────────────────────────────
//  CREATE SEMESTER BOOKING
//  POST /api/hostels/book
//
//  Student books a hostel room for a semester or monthly period.
//
//  Edge cases handled:
//    — Student cannot book their own hostel
//    — Property must be HOSTEL type and AVAILABLE
//    — FIXED requires fixedEndDate
//    — SCHOOL_CALENDAR requires schoolId — school verified in database
//    — Room overlap check — same room same semester blocked
//    — Price from database PaymentStructure — never from body
//    — Reference generated server side
//    — Audit log fires after transaction
// ─────────────────────────────────────────────────────────────────────────────
export const createSemesterBooking = async (
  req: Request,
  res: Response<ApiResponse>
): Promise<void> => {
  const studentClerkId = requireAuth(req, res);
  if (!studentClerkId) return;

  const parsed = createSemesterBookingSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      success: false,
      message: "Validation failed",
      errors:  formatZodErrors(parsed.error.issues),
    });
    return;
  }

  const {
    propertyId,
    semesterName,
    checkIn,
    closingType,
    fixedEndDate,
    schoolId,
    roomNumber,
  } = parsed.data;

  // FIXED closingType requires an exact end date
  if (closingType === "FIXED" && !fixedEndDate) {
    res.status(400).json({
      success: false,
      message: "fixedEndDate is required when closingType is FIXED",
    });
    return;
  }

  // SCHOOL_CALENDAR closingType requires a linked school
  if (closingType === "SCHOOL_CALENDAR" && !schoolId) {
    res.status(400).json({
      success: false,
      message: "schoolId is required when closingType is SCHOOL_CALENDAR",
    });
    return;
  }

  const checkInDate = new Date(checkIn);
  const now         = new Date();

  // checkIn must be in the future
  if (checkInDate <= now) {
    res.status(400).json({
      success: false,
      message: "Check in date must be in the future",
    });
    return;
  }

  // fixedEndDate must be after checkIn
  if (fixedEndDate && new Date(fixedEndDate) <= checkInDate) {
    res.status(400).json({
      success: false,
      message: "fixedEndDate must be after checkIn date",
    });
    return;
  }

  try {
    // Fetch hostel with payment structures — single query — no N+1
    const property = await prisma.property.findFirst({
      where: {
        id:            propertyId,
        listingType:   "HOSTEL",
        listingStatus: "AVAILABLE",
        deletedAt:     null,
        isArchived:    false,
      },
      include: {
        structures: {
          where: {
            durationType: { in: ["SEMESTER", "MONTHLY"] },
            isActive:     true,
          },
        },
      },
    });

    if (!property) {
      res.status(404).json({
        success: false,
        message: "Hostel not found or not available for booking",
      });
      return;
    }

    // Student cannot book their own hostel
    if (property.managerClerkId === studentClerkId) {
      res.status(400).json({
        success: false,
        message: "You cannot book your own hostel",
      });
      return;
    }

    // Pricing must exist for semester or monthly duration
    const priceStructure = property.structures[0];
    if (!priceStructure) {
      res.status(400).json({
        success: false,
        message: "This hostel does not have active pricing configured",
      });
      return;
    }

    // Room overlap check — same room same semester blocked
    if (roomNumber) {
      const roomConflict = await prisma.semesterPlan.findFirst({
        where: {
          propertyId,
          roomNumber,
          semesterName,
          status: {
            in: [
              HostelBookingStatus.ACTIVE,
              HostelBookingStatus.EXPIRING,
              HostelBookingStatus.EXTENDED,
            ],
          },
        },
      });

      if (roomConflict) {
        res.status(400).json({
          success: false,
          message: `Room ${roomNumber} is already booked for ${semesterName}`,
        });
        return;
      }
    }

    // Verify school exists for SCHOOL_CALENDAR bookings
    if (closingType === "SCHOOL_CALENDAR" && schoolId) {
      const school = await prisma.school.findUnique({
        where: { id: schoolId },
      });

      if (!school) {
        res.status(404).json({
          success: false,
          message: "School not found",
        });
        return;
      }
    }

    // Create booking in transaction — atomic operation
    const booking = await prisma.$transaction(async (tx) => {
      return await tx.semesterPlan.create({
        data: {
          propertyId,
          studentClerkId,
          semesterName,
          checkIn:      checkInDate,
          closingType:  closingType as ClosingType,
          fixedEndDate: fixedEndDate ? new Date(fixedEndDate) : null,
          schoolId:     schoolId    ?? null,
          roomNumber:   roomNumber  ?? null,
          amountPaid:   priceStructure.price,
          reference:    generateHostelReference(),
          status:       HostelBookingStatus.ACTIVE,
        },
      });
    });

    // Audit log fires AFTER transaction — never inside it
    await logUserEvent({
      userClerkId: studentClerkId,
      action:      "HOSTEL_BOOKING_CREATED",
      target:      `SemesterPlan #${booking.id} — Property #${propertyId}`,
      details:     `Semester: ${semesterName}. Room: ${roomNumber ?? "Unassigned"}. Type: ${closingType}`,
    });

    res.status(201).json({
      success: true,
      message: "Hostel booking confirmed successfully",
      data:    booking,
    });
  } catch (error) {
    console.error("[hostelControllers.createSemesterBooking]", {
      propertyId,
      studentClerkId,
      error: error instanceof Error ? error.message : error,
    });
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
//  GET STUDENT BOOKINGS
//  GET /api/hostels/my
//
//  Returns all hostel bookings for the logged-in student.
//  Includes school info for SCHOOL_CALENDAR bookings.
//  Ordered by check in date — most recent first.
// ─────────────────────────────────────────────────────────────────────────────
export const getStudentBookings = async (
  req: Request,
  res: Response<ApiResponse>
): Promise<void> => {
  const studentClerkId = requireAuth(req, res);
  if (!studentClerkId) return;

  try {
    const bookings = await prisma.semesterPlan.findMany({
      where:   { studentClerkId },
      include: {
        school: {
          select: {
            id:       true,
            name:     true,
            location: true,
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
    console.error("[hostelControllers.getStudentBookings]", {
      studentClerkId,
      error: error instanceof Error ? error.message : error,
    });
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
//  GET HOSTEL BOOKINGS — MANAGER
//  GET /api/hostels/property/:propertyId
//
//  Returns all bookings for a specific hostel.
//  Only the manager who owns the hostel can view.
//  Groups bookings by room number for dashboard display.
// ─────────────────────────────────────────────────────────────────────────────
export const getHostelBookings = async (
  req: Request,
  res: Response<ApiResponse>
): Promise<void> => {
  const managerClerkId = requireAuth(req, res);
  if (!managerClerkId) return;

  const propertyId = getNumericParam(req.params.propertyId, "propertyId", res);
  if (!propertyId) return;

  try {
    // Authorization — manager must own this hostel
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
        message: "Hostel not found or you do not have permission",
      });
      return;
    }

    const bookings = await prisma.semesterPlan.findMany({
      where:   { propertyId },
      include: {
        school: {
          select: { id: true, name: true },
        },
      },
      orderBy: { checkIn: "desc" },
    });

    // Group by room number for easy dashboard display
    type BookingWithSchool = typeof bookings[number];
    const byRoom = bookings.reduce<Record<string, BookingWithSchool[]>>((acc, b) => {
      const room = b.roomNumber ?? "Unassigned";
      acc[room]  = acc[room] ?? [];
      acc[room].push(b);
      return acc;
    }, {});

    const totalOccupied = bookings.filter(b =>
      b.status === HostelBookingStatus.ACTIVE   ||
      b.status === HostelBookingStatus.EXPIRING ||
      b.status === HostelBookingStatus.EXTENDED
    ).length;

    res.status(200).json({
      success: true,
      message: "Hostel bookings retrieved successfully",
      data: {
        bookings,
        byRoom,
        totalOccupied,
      },
    });
  } catch (error) {
    console.error("[hostelControllers.getHostelBookings]", {
      propertyId,
      managerClerkId,
      error: error instanceof Error ? error.message : error,
    });
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
//  CHECKOUT STUDENT
//  PUT /api/hostels/:bookingId/checkout
//
//  Manager records when a student has left the hostel.
//  Sets actualEndDate and marks booking as COMPLETED.
//  Two-step authorization — booking found first then property ownership checked.
//  Cannot checkout a booking that is already COMPLETED or EXPIRED.
// ─────────────────────────────────────────────────────────────────────────────
export const checkoutStudent = async (
  req: Request,
  res: Response<ApiResponse>
): Promise<void> => {
  const managerClerkId = requireAuth(req, res);
  if (!managerClerkId) return;

  const bookingId = getNumericParam(req.params.bookingId, "bookingId", res);
  if (!bookingId) return;

  const parsed = checkoutStudentSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      success: false,
      message: "Validation failed",
      errors:  formatZodErrors(parsed.error.issues),
    });
    return;
  }

  const { actualEndDate } = parsed.data;

  try {
    // Step 1 — find the booking
    const booking = await prisma.semesterPlan.findUnique({
      where: { id: bookingId },
    });

    if (!booking) {
      res.status(404).json({
        success: false,
        message: "Booking not found",
      });
      return;
    }

    // Step 2 — verify manager owns the hostel for this booking
    const property = await prisma.property.findFirst({
      where: {
        id:            booking.propertyId,
        managerClerkId,
        deletedAt:     null,
      },
    });

    if (!property) {
      res.status(403).json({
        success: false,
        message: "You do not have permission to manage this booking",
      });
      return;
    }

    // Status guard — cannot checkout completed or expired bookings
    if (
      booking.status === HostelBookingStatus.COMPLETED ||
      booking.status === HostelBookingStatus.EXPIRED
    ) {
      res.status(400).json({
        success: false,
        message: `Cannot checkout a booking with status: ${booking.status}`,
      });
      return;
    }

    await prisma.semesterPlan.update({
      where: { id: bookingId },
      data: {
        actualEndDate: new Date(actualEndDate),
        status:        HostelBookingStatus.COMPLETED,
      },
    });

    await logSystemEvent({
      action:  "HOSTEL_STUDENT_CHECKOUT",
      target:  `SemesterPlan #${bookingId}`,
      details: `Student checked out. Actual end: ${actualEndDate}. Property #${booking.propertyId}`,
    });

    res.status(200).json({
      success: true,
      message: "Student checked out successfully",
    });
  } catch (error) {
    console.error("[hostelControllers.checkoutStudent]", {
      bookingId,
      managerClerkId,
      error: error instanceof Error ? error.message : error,
    });
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
//  EXTEND STAY
//  PUT /api/hostels/:bookingId/extend
//
//  Manager extends a student stay beyond the original end date.
//  Used when a student stays past the semester closing date.
//  New end date must be in the future.
//  Cannot extend COMPLETED or EXPIRED bookings.
//  Two-step authorization — booking first then property ownership.
// ─────────────────────────────────────────────────────────────────────────────
export const extendStay = async (
  req: Request,
  res: Response<ApiResponse>
): Promise<void> => {
  const managerClerkId = requireAuth(req, res);
  if (!managerClerkId) return;

  const bookingId = getNumericParam(req.params.bookingId, "bookingId", res);
  if (!bookingId) return;

  const parsed = extendStaySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      success: false,
      message: "Validation failed",
      errors:  formatZodErrors(parsed.error.issues),
    });
    return;
  }

  const { newEndDate } = parsed.data;

  try {
    // Step 1 — find the booking
    const booking = await prisma.semesterPlan.findUnique({
      where: { id: bookingId },
    });

    if (!booking) {
      res.status(404).json({
        success: false,
        message: "Booking not found",
      });
      return;
    }

    // Step 2 — verify manager owns the hostel
    const property = await prisma.property.findFirst({
      where: {
        id:            booking.propertyId,
        managerClerkId,
        deletedAt:     null,
      },
    });

    if (!property) {
      res.status(403).json({
        success: false,
        message: "You do not have permission to manage this booking",
      });
      return;
    }

    // Status guard — cannot extend completed or expired bookings
    if (
      booking.status === HostelBookingStatus.COMPLETED ||
      booking.status === HostelBookingStatus.EXPIRED
    ) {
      res.status(400).json({
        success: false,
        message: "Cannot extend a completed or expired booking",
      });
      return;
    }

    const newEnd = new Date(newEndDate);

    // New end date must be in the future
    if (newEnd <= new Date()) {
      res.status(400).json({
        success: false,
        message: "New end date must be in the future",
      });
      return;
    }

    await prisma.semesterPlan.update({
      where: { id: bookingId },
      data: {
        fixedEndDate: newEnd,
        status:       HostelBookingStatus.EXTENDED,
      },
    });

    await logSystemEvent({
      action:  "HOSTEL_STAY_EXTENDED",
      target:  `SemesterPlan #${bookingId}`,
      details: `Extended to ${newEndDate} by manager ${managerClerkId}. Property #${booking.propertyId}`,
    });

    res.status(200).json({
      success: true,
      message: "Stay extended successfully",
    });
  } catch (error) {
    console.error("[hostelControllers.extendStay]", {
      bookingId,
      managerClerkId,
      error: error instanceof Error ? error.message : error,
    });
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
//  GET ROOM AVAILABILITY
//  GET /api/hostels/:propertyId/availability
//
//  Returns occupied rooms and active bookings for a hostel.
//  Public endpoint — no auth required for viewing availability.
//  Used by prospective students browsing available rooms.
// ─────────────────────────────────────────────────────────────────────────────
export const getRoomAvailability = async (
  req: Request,
  res: Response<ApiResponse>
): Promise<void> => {
  const propertyId = getNumericParam(req.params.propertyId, "propertyId", res);
  if (!propertyId) return;

  try {
    const property = await prisma.property.findFirst({
      where: {
        id:          propertyId,
        listingType: "HOSTEL",
        deletedAt:   null,
        isArchived:  false,
      },
    });

    if (!property) {
      res.status(404).json({
        success: false,
        message: "Hostel not found",
      });
      return;
    }

    const activeBookings = await prisma.semesterPlan.findMany({
      where: {
        propertyId,
        status: {
          in: [
            HostelBookingStatus.ACTIVE,
            HostelBookingStatus.EXPIRING,
            HostelBookingStatus.EXTENDED,
          ],
        },
      },
      select: {
        roomNumber:   true,
        semesterName: true,
        status:       true,
        checkIn:      true,
        fixedEndDate: true,
      },
    });

    const occupiedRooms = activeBookings
      .filter(b  => b.roomNumber !== null)
      .map(b     => b.roomNumber as string);

    res.status(200).json({
      success: true,
      message: "Room availability retrieved",
      data: {
        propertyId,
        occupiedRooms,
        totalOccupied: occupiedRooms.length,
        activeBookings,
      },
    });
  } catch (error) {
    console.error("[hostelControllers.getRoomAvailability]", {
      propertyId,
      error: error instanceof Error ? error.message : error,
    });
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
//  GET ALL HOSTEL BOOKINGS — ADMIN
//  GET /api/hostels/admin/all
//
//  Returns all hostel bookings platform wide — Derek only.
//  Paginated — prevents memory overload as platform scales.
//  Both queries run in parallel — faster response time.
// ─────────────────────────────────────────────────────────────────────────────
export const getAllHostelBookings = async (
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
      prisma.semesterPlan.findMany({
        skip,
        take: limit,
        include: {
          school: {
            select: { id: true, name: true },
          },
        },
        orderBy: { checkIn: "desc" },
      }),
      prisma.semesterPlan.count(),
    ]);

    res.status(200).json({
      success: true,
      message: "All hostel bookings retrieved",
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
    console.error("[hostelControllers.getAllHostelBookings]", {
      adminClerkId,
      error: error instanceof Error ? error.message : error,
    });
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};