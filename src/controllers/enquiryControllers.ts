import { Request, Response }          from "express";
import { z }                          from "zod";
import { prisma }                     from "../lib/prisma";
import { logUserEvent, logSystemEvent } from "../lib/auditService";
import { EnquiryStatus }              from "@prisma/client";

// ─────────────────────────────────────────────────────────────────────────────
//  enquiryControllers.ts
//
//  Handles all buyer enquiries on AskDerek.
//
//  Business rules enforced:
//    — All contact goes through AskDerek — no direct phone numbers
//    — A buyer cannot enquire on their own property
//    — One active enquiry per buyer per property maximum
//    — Manager can only access enquiries on their own properties
//    — Buyer can only see their own enquiries
//    — Status transitions are strictly ordered and validated
//    — Commission is calculated automatically on deal completion
//    — Every action is audit logged permanently
//
//  Status flow:
//    NEW → CONTACTED → NEGOTIATING → AGREED → COMPLETED
//                                           → LOST (any stage)
// ─────────────────────────────────────────────────────────────────────────────

// ── RESPONSE TYPES ────────────────────────────────────────────────────────────

interface ApiSuccess<T = undefined> {
  success: true;
  message: string;
  data?:   T;
}

interface ApiError {
  success: false;
  message: string;
  errors?: { field: string; message: string }[];
}

type ApiResponse<T = undefined> = ApiSuccess<T> | ApiError;

// ── VALIDATION SCHEMAS ────────────────────────────────────────────────────────

const createEnquirySchema = z.object({
  propertyId:  z.number({
    required_error:     "propertyId is required",
    invalid_type_error: "propertyId must be a number",
  }).int().positive("propertyId must be a positive integer"),
  message: z.string({
    required_error: "message is required",
  }).min(10, "Message must be at least 10 characters")
    .max(1000, "Message cannot exceed 1000 characters"),
  enquiryType: z.enum(["MESSAGE", "CALL_REQUEST", "VIEWING"], {
    required_error: "enquiryType is required",
  }),
  offeredPrice: z.number().positive().optional(),
});

const updateStatusSchema = z.object({
  status: z.enum([
    "CONTACTED",
    "NEGOTIATING",
    "AGREED",
    "LOST",
  ], { required_error: "status is required" }),
});

const recordDealSchema = z.object({
  agreedPrice: z.number({
    required_error:     "agreedPrice is required",
    invalid_type_error: "agreedPrice must be a number",
  }).positive("agreedPrice must be greater than zero"),
  notes: z.string().max(500).optional(),
});

const respondSchema = z.object({
  response: z.string({
    required_error: "response is required",
  }).min(1, "Response cannot be empty")
    .max(1000, "Response cannot exceed 1000 characters"),
});

// ── SHARED HELPERS ────────────────────────────────────────────────────────────

// Extracts userId from the verified Clerk JWT.
// Identity must always come from the JWT — never from req.body.
const requireAuth = (
  req: Request,
  res: Response
): string | null => {
  const userId = req.auth?.userId;
  if (!userId) {
    res.status(401).json({ success: false, message: "Unauthorized" });
    return null;
  }
  return userId;
};

// Validates the enquiryId route parameter.
const getEnquiryId = (
  req: Request,
  res: Response
): number | null => {
  const id = Number(req.params.enquiryId);
  if (isNaN(id) || id <= 0) {
    res.status(400).json({ success: false, message: "Invalid enquiryId" });
    return null;
  }
  return id;
};

// Converts Zod issues into the standard API error shape.
const formatZodErrors = (
  issues: z.ZodIssue[]
): { field: string; message: string }[] =>
  issues.map(i => ({
    field:   String(i.path[0] ?? "unknown"),
    message: i.message,
  }));

// ─────────────────────────────────────────────────────────────────────────────
//  CREATE ENQUIRY
//  POST /api/enquiries
//
//  Buyer sends an enquiry about a property.
//
//  Edge cases handled:
//    — Cannot enquire on your own property
//    — Cannot enquire on a deleted or archived property
//    — Cannot create duplicate active enquiry on same property
//    — Property must be AVAILABLE
// ─────────────────────────────────────────────────────────────────────────────
export const createEnquiry = async (
  req: Request,
  res: Response<ApiResponse>
): Promise<void> => {
  const enquirerClerkId = requireAuth(req, res);
  if (!enquirerClerkId) return;

  const parsed = createEnquirySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      success: false,
      message: "Validation failed",
      errors:  formatZodErrors(parsed.error.issues),
    });
    return;
  }

  const { propertyId, message, enquiryType, offeredPrice } = parsed.data;

  try {
    // Fetch property with manager info in one query — no N+1
    const property = await prisma.property.findFirst({
      where: {
        id:         propertyId,
        deletedAt:  null,
        isArchived: false,
        listingStatus: { in: ["AVAILABLE", "UNDER_OFFER"] },
      },
      select: {
        id:            true,
        name:          true,
        managerClerkId: true,
        listingStatus: true,
        listingType:   true,
      },
    });

    if (!property) {
      res.status(404).json({
        success: false,
        message: "Property not found or not available for enquiry",
      });
      return;
    }

    // A manager cannot enquire on their own property
    if (property.managerClerkId === enquirerClerkId) {
      res.status(400).json({
        success: false,
        message: "You cannot enquire on your own property",
      });
      return;
    }

    // Prevent duplicate active enquiry — one per buyer per property
    const existingEnquiry = await prisma.enquiry.findFirst({
      where: {
        propertyId,
        enquirerClerkId,
        status: {
          notIn: [EnquiryStatus.COMPLETED, EnquiryStatus.LOST],
        },
        isArchived: false,
      },
    });

    if (existingEnquiry) {
      res.status(400).json({
        success: false,
        message: "You already have an active enquiry for this property",
      });
      return;
    }

    // Create enquiry and first message atomically
    const enquiry = await prisma.$transaction(async (tx) => {
      const created = await tx.enquiry.create({
        data: {
          propertyId,
          enquirerClerkId,
          managerClerkId:  property.managerClerkId,
          enquiryType,
          status:          EnquiryStatus.NEW,
          offeredPrice:    offeredPrice ?? null,
          isRead:          false,
          isArchived:      false,
        },
      });

      // First message is created as part of the enquiry
      await tx.message.create({
        data: {
          enquiryId:      created.id,
          senderClerkId:  enquirerClerkId,
          content:        message,
        },
      });

      return created;
    });

    await logUserEvent({
      userClerkId: enquirerClerkId,
      action:      "ENQUIRY_CREATED",
      target:      `Property #${propertyId}`,
      details:     `Enquiry #${enquiry.id} created. Type: ${enquiryType}`,
    });

    res.status(201).json({
      success: true,
      message: "Enquiry sent successfully",
      data:    enquiry,
    });
  } catch (error) {
    console.error("[enquiryControllers.createEnquiry]", {
      propertyId,
      enquirerClerkId,
      error: error instanceof Error ? error.message : error,
    });
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
//  GET USER ENQUIRIES
//  GET /api/enquiries/my
//
//  Returns all enquiries created by the logged-in buyer.
//  Includes property name and manager info for display.
//  Excludes archived enquiries by default.
// ─────────────────────────────────────────────────────────────────────────────
export const getUserEnquiries = async (
  req: Request,
  res: Response<ApiResponse>
): Promise<void> => {
  const enquirerClerkId = requireAuth(req, res);
  if (!enquirerClerkId) return;

  try {
    const enquiries = await prisma.enquiry.findMany({
      where: {
        enquirerClerkId,
        isArchived: false,
      },
      include: {
        property: {
          select: {
            id:            true,
            name:          true,
            listingType:   true,
            listingStatus: true,
            askingPrice:   true,
            pricePerMonth: true,
          },
        },
        // Latest message for preview — avoids loading full history
        messages: {
          orderBy: { createdAt: "desc" },
          take:    1,
          select: {
            content:   true,
            createdAt: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    res.status(200).json({
      success: true,
      message: "Enquiries retrieved successfully",
      data:    enquiries,
    });
  } catch (error) {
    console.error("[enquiryControllers.getUserEnquiries]", {
      enquirerClerkId,
      error: error instanceof Error ? error.message : error,
    });
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
//  GET MANAGER ENQUIRIES
//  GET /api/enquiries/manager
//
//  Returns all enquiries for properties owned by this manager.
//  Includes buyer info and latest message for dashboard display.
//  Ordered by unread first then by date.
// ─────────────────────────────────────────────────────────────────────────────
export const getManagerEnquiries = async (
  req: Request,
  res: Response<ApiResponse>
): Promise<void> => {
  const managerClerkId = requireAuth(req, res);
  if (!managerClerkId) return;

  try {
    const enquiries = await prisma.enquiry.findMany({
      where: {
        managerClerkId,
        isArchived: false,
      },
      include: {
        property: {
          select: {
            id:            true,
            name:          true,
            listingType:   true,
            listingStatus: true,
          },
        },
        // Latest message preview — no N+1 — single query with take
        messages: {
          orderBy: { createdAt: "desc" },
          take:    1,
          select: {
            content:      true,
            createdAt:    true,
            senderClerkId: true,
          },
        },
      },
      orderBy: [
        { isRead: "asc" },   // unread enquiries appear first
        { createdAt: "desc" },
      ],
    });

    res.status(200).json({
      success: true,
      message: "Enquiries retrieved successfully",
      data:    enquiries,
    });
  } catch (error) {
    console.error("[enquiryControllers.getManagerEnquiries]", {
      managerClerkId,
      error: error instanceof Error ? error.message : error,
    });
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
//  MARK ENQUIRY AS READ
//  PUT /api/enquiries/:enquiryId/read
//
//  Manager marks an enquiry as read.
//  Only the manager who owns the property can mark it as read.
// ─────────────────────────────────────────────────────────────────────────────
export const markEnquiryAsRead = async (
  req: Request,
  res: Response<ApiResponse>
): Promise<void> => {
  const managerClerkId = requireAuth(req, res);
  if (!managerClerkId) return;

  const enquiryId = getEnquiryId(req, res);
  if (!enquiryId) return;

  try {
    // Authorization — confirm this manager owns this enquiry
    const enquiry = await prisma.enquiry.findFirst({
      where: {
        id:            enquiryId,
        managerClerkId,
        isArchived:    false,
      },
    });

    if (!enquiry) {
      res.status(404).json({
        success: false,
        message: "Enquiry not found or you do not have permission",
      });
      return;
    }

    if (enquiry.isRead) {
      res.status(200).json({
        success: true,
        message: "Enquiry already marked as read",
      });
      return;
    }

    await prisma.enquiry.update({
      where: { id: enquiryId },
      data: {
        isRead: true,
        readAt: new Date(),
      },
    });

    res.status(200).json({
      success: true,
      message: "Enquiry marked as read",
    });
  } catch (error) {
    console.error("[enquiryControllers.markEnquiryAsRead]", {
      enquiryId,
      managerClerkId,
      error: error instanceof Error ? error.message : error,
    });
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
//  RESPOND TO ENQUIRY
//  PUT /api/enquiries/:enquiryId/respond
//
//  Manager sends a response to a buyer enquiry.
//  Creates a message in the thread and updates status to CONTACTED.
//  Only valid if enquiry is in NEW or CONTACTED status.
// ─────────────────────────────────────────────────────────────────────────────
export const respondToEnquiry = async (
  req: Request,
  res: Response<ApiResponse>
): Promise<void> => {
  const managerClerkId = requireAuth(req, res);
  if (!managerClerkId) return;

  const enquiryId = getEnquiryId(req, res);
  if (!enquiryId) return;

  const parsed = respondSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      success: false,
      message: "Validation failed",
      errors:  formatZodErrors(parsed.error.issues),
    });
    return;
  }

  const { response } = parsed.data;

  try {
    const enquiry = await prisma.enquiry.findFirst({
      where: {
        id:            enquiryId,
        managerClerkId,
        isArchived:    false,
      },
    });

    if (!enquiry) {
      res.status(404).json({
        success: false,
        message: "Enquiry not found or you do not have permission",
      });
      return;
    }

    // Cannot respond to completed or lost enquiries
    if (
      enquiry.status === EnquiryStatus.COMPLETED ||
      enquiry.status === EnquiryStatus.LOST
    ) {
      res.status(400).json({
        success: false,
        message: "Cannot respond to a completed or lost enquiry",
      });
      return;
    }

    // Response and message creation are atomic
    await prisma.$transaction([
      prisma.enquiry.update({
        where: { id: enquiryId },
        data: {
          response:      response,
          respondedAt:   new Date(),
          isRead:        true,
          readAt:        enquiry.readAt ?? new Date(),
          status:        enquiry.status === EnquiryStatus.NEW
                           ? EnquiryStatus.CONTACTED
                           : enquiry.status,
        },
      }),
      prisma.message.create({
        data: {
          enquiryId,
          senderClerkId: managerClerkId,
          content:       response,
        },
      }),
    ]);

    await logUserEvent({
      userClerkId: managerClerkId,
      action:      "ENQUIRY_RESPONDED",
      target:      `Enquiry #${enquiryId}`,
      details:     `Manager responded to enquiry`,
    });

    res.status(200).json({
      success: true,
      message: "Response sent successfully",
    });
  } catch (error) {
    console.error("[enquiryControllers.respondToEnquiry]", {
      enquiryId,
      managerClerkId,
      error: error instanceof Error ? error.message : error,
    });
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
//  UPDATE ENQUIRY STATUS
//  PUT /api/enquiries/:enquiryId/status
//
//  Manager updates the deal pipeline status.
//  Enforces valid status transitions — cannot skip stages.
//  Status flow: NEW → CONTACTED → NEGOTIATING → AGREED → COMPLETED/LOST
// ─────────────────────────────────────────────────────────────────────────────
export const updateEnquiryStatus = async (
  req: Request,
  res: Response<ApiResponse>
): Promise<void> => {
  const managerClerkId = requireAuth(req, res);
  if (!managerClerkId) return;

  const enquiryId = getEnquiryId(req, res);
  if (!enquiryId) return;

  const parsed = updateStatusSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      success: false,
      message: "Validation failed",
      errors:  formatZodErrors(parsed.error.issues),
    });
    return;
  }

  const { status } = parsed.data;

  try {
    const enquiry = await prisma.enquiry.findFirst({
      where: {
        id:            enquiryId,
        managerClerkId,
        isArchived:    false,
      },
    });

    if (!enquiry) {
      res.status(404).json({
        success: false,
        message: "Enquiry not found or you do not have permission",
      });
      return;
    }

    // Cannot update a completed or lost enquiry
    if (
      enquiry.status === EnquiryStatus.COMPLETED ||
      enquiry.status === EnquiryStatus.LOST
    ) {
      res.status(400).json({
        success: false,
        message: "Cannot update a completed or lost enquiry",
      });
      return;
    }

    // Valid forward transitions only — prevents skipping stages
    const validTransitions: Record<string, string[]> = {
      NEW:         ["CONTACTED", "LOST"],
      CONTACTED:   ["NEGOTIATING", "LOST"],
      NEGOTIATING: ["AGREED", "LOST"],
      AGREED:      ["LOST"],
    };

    const allowed = validTransitions[enquiry.status] ?? [];
    if (!allowed.includes(status)) {
      res.status(400).json({
        success: false,
        message: `Cannot transition from ${enquiry.status} to ${status}`,
      });
      return;
    }

    await prisma.enquiry.update({
      where: { id: enquiryId },
      data:  { status: EnquiryStatus[status as keyof typeof EnquiryStatus] },
    });

    await logSystemEvent({
      action:  "ENQUIRY_STATUS_UPDATED",
      target:  `Enquiry #${enquiryId}`,
      details: `Status changed from ${enquiry.status} to ${status} by ${managerClerkId}`,
    });

    res.status(200).json({
      success: true,
      message: `Enquiry status updated to ${status}`,
    });
  } catch (error) {
    console.error("[enquiryControllers.updateEnquiryStatus]", {
      enquiryId,
      managerClerkId,
      error: error instanceof Error ? error.message : error,
    });
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
//  RECORD DEAL
//  PUT /api/enquiries/:enquiryId/deal
//
//  Manager records the agreed price after negotiation.
//  Enquiry must be in NEGOTIATING status.
//  Calculates AskDerek 5% commission automatically.
//  Changes status to AGREED.
// ─────────────────────────────────────────────────────────────────────────────
export const recordDeal = async (
  req: Request,
  res: Response<ApiResponse>
): Promise<void> => {
  const managerClerkId = requireAuth(req, res);
  if (!managerClerkId) return;

  const enquiryId = getEnquiryId(req, res);
  if (!enquiryId) return;

  const parsed = recordDealSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      success: false,
      message: "Validation failed",
      errors:  formatZodErrors(parsed.error.issues),
    });
    return;
  }

  const { agreedPrice, notes } = parsed.data;

  try {
    const enquiry = await prisma.enquiry.findFirst({
      where: {
        id:            enquiryId,
        managerClerkId,
        isArchived:    false,
      },
    });

    if (!enquiry) {
      res.status(404).json({
        success: false,
        message: "Enquiry not found or you do not have permission",
      });
      return;
    }

    // Must be NEGOTIATING before a deal can be recorded
    if (enquiry.status !== EnquiryStatus.NEGOTIATING) {
      res.status(400).json({
        success: false,
        message: `Deal can only be recorded when status is NEGOTIATING. Current: ${enquiry.status}`,
      });
      return;
    }

    const commissionDue = agreedPrice * 0.05;
    const landlordNet   = agreedPrice * 0.95;

    await prisma.enquiry.update({
      where: { id: enquiryId },
      data: {
        agreedPrice,
        commissionDue,
        notes:  notes ?? enquiry.notes,
        status: EnquiryStatus.AGREED,
      },
    });

    await logUserEvent({
      userClerkId: managerClerkId,
      action:      "DEAL_RECORDED",
      target:      `Enquiry #${enquiryId}`,
      details:     `Deal agreed at GHS ${agreedPrice}. Commission: GHS ${commissionDue}. Net: GHS ${landlordNet}`,
    });

    res.status(200).json({
      success: true,
      message: "Deal recorded successfully",
      data: {
        agreedPrice,
        commissionDue,
        landlordReceives: landlordNet,
      },
    });
  } catch (error) {
    console.error("[enquiryControllers.recordDeal]", {
      enquiryId,
      managerClerkId,
      error: error instanceof Error ? error.message : error,
    });
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
//  RECORD COMPLETION
//  PUT /api/enquiries/:enquiryId/complete
//
//  Manager confirms the deal is fully completed — buyer has paid.
//  Enquiry must be in AGREED status before completion.
//  Marks the associated property as SOLD or RENTED automatically.
//  Final commission is locked in permanently.
// ─────────────────────────────────────────────────────────────────────────────
export const recordCompletion = async (
  req: Request,
  res: Response<ApiResponse>
): Promise<void> => {
  const managerClerkId = requireAuth(req, res);
  if (!managerClerkId) return;

  const enquiryId = getEnquiryId(req, res);
  if (!enquiryId) return;

  try {
    const enquiry = await prisma.enquiry.findFirst({
      where: {
        id:            enquiryId,
        managerClerkId,
        isArchived:    false,
      },
      include: {
        property: {
          select: {
            id:          true,
            listingType: true,
          },
        },
      },
    });

    if (!enquiry) {
      res.status(404).json({
        success: false,
        message: "Enquiry not found or you do not have permission",
      });
      return;
    }

    // Must be AGREED before completion can be recorded
    if (enquiry.status !== EnquiryStatus.AGREED) {
      res.status(400).json({
        success: false,
        message: `Completion can only be recorded when status is AGREED. Current: ${enquiry.status}`,
      });
      return;
    }

    if (!enquiry.agreedPrice) {
      res.status(400).json({
        success: false,
        message: "Cannot complete enquiry without an agreed price. Call recordDeal first.",
      });
      return;
    }

    const now           = new Date();
    const isSale        = enquiry.property.listingType === "FOR_SALE" ||
                          enquiry.property.listingType === "LAND";
    const newStatus     = isSale ? "SOLD" : "RENTED";

    // Atomic — enquiry completion and property status update together
    await prisma.$transaction([
      prisma.enquiry.update({
        where: { id: enquiryId },
        data: {
          status:      EnquiryStatus.COMPLETED,
          completedAt: now,
        },
      }),
      prisma.property.update({
        where: { id: enquiry.property.id },
        data: {
          listingStatus: newStatus,
          soldAt:        isSale ? now : null,
          soldPrice:     isSale ? enquiry.agreedPrice : null,
        },
      }),
    ]);

    await logUserEvent({
      userClerkId: managerClerkId,
      action:      "DEAL_COMPLETED",
      target:      `Enquiry #${enquiryId}`,
      details:     `Deal completed. Property #${enquiry.property.id} marked ${newStatus}. Commission due: GHS ${enquiry.commissionDue}`,
    });

    res.status(200).json({
      success: true,
      message: "Deal completed successfully",
      data: {
        enquiryId,
        propertyStatus:   newStatus,
        finalPrice:       enquiry.agreedPrice,
        commissionDue:    enquiry.commissionDue,
        landlordReceives: enquiry.agreedPrice - (enquiry.commissionDue ?? 0),
      },
    });
  } catch (error) {
    console.error("[enquiryControllers.recordCompletion]", {
      enquiryId,
      managerClerkId,
      error: error instanceof Error ? error.message : error,
    });
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
//  ARCHIVE ENQUIRY
//  PUT /api/enquiries/:enquiryId/archive
//
//  Soft archives an enquiry — hides it from default views.
//  Either the buyer or the manager can archive their own enquiry.
//  Data is preserved — never hard deleted.
// ─────────────────────────────────────────────────────────────────────────────
export const archiveEnquiry = async (
  req: Request,
  res: Response<ApiResponse>
): Promise<void> => {
  const userId = requireAuth(req, res);
  if (!userId) return;

  const enquiryId = getEnquiryId(req, res);
  if (!enquiryId) return;

  try {
    // Either the buyer or the manager can archive
    const enquiry = await prisma.enquiry.findFirst({
      where: {
        id: enquiryId,
        OR: [
          { enquirerClerkId: userId },
          { managerClerkId:  userId },
        ],
      },
    });

    if (!enquiry) {
      res.status(404).json({
        success: false,
        message: "Enquiry not found or you do not have permission",
      });
      return;
    }

    if (enquiry.isArchived) {
      res.status(400).json({
        success: false,
        message: "Enquiry is already archived",
      });
      return;
    }

    await prisma.enquiry.update({
      where: { id: enquiryId },
      data: {
        isArchived: true,
        archivedAt: new Date(),
      },
    });

    await logUserEvent({
      userClerkId: userId,
      action:      "ENQUIRY_ARCHIVED",
      target:      `Enquiry #${enquiryId}`,
      details:     `Archived by ${userId}`,
    });

    res.status(200).json({
      success: true,
      message: "Enquiry archived successfully",
    });
  } catch (error) {
    console.error("[enquiryControllers.archiveEnquiry]", {
      enquiryId,
      userId,
      error: error instanceof Error ? error.message : error,
    });
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
//  GET ALL ENQUIRIES — ADMIN
//  GET /api/enquiries/admin/all
//
//  Returns all enquiries platform wide — Derek only.
//  Includes full property and pipeline data.
//  Used for commission tracking and deal monitoring.
// ─────────────────────────────────────────────────────────────────────────────
export const getAllEnquiries = async (
  req: Request,
  res: Response<ApiResponse>
): Promise<void> => {
  const userId = requireAuth(req, res);
  if (!userId) return;

  try {
    // Verify admin role from database — JWT alone is not sufficient
    const user = await prisma.user.findUnique({
      where:  { clerkId: userId },
      select: { role: true, isActive: true },
    });

    if (!user || user.role !== "ADMIN" || !user.isActive) {
      res.status(403).json({ success: false, message: "Forbidden" });
      return;
    }

    const enquiries = await prisma.enquiry.findMany({
      include: {
        property: {
          select: {
            id:            true,
            name:          true,
            listingType:   true,
            listingStatus: true,
          },
        },
        messages: {
          orderBy: { createdAt: "desc" },
          take:    1,
          select: {
            content:   true,
            createdAt: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    // Commission summary for Derek's dashboard
    const totalCommission = enquiries.reduce(
      (sum, e) => sum + (e.commissionDue ?? 0),
      0
    );

    res.status(200).json({
      success: true,
      message: "All enquiries retrieved",
      data: {
        enquiries,
        summary: {
          total:            enquiries.length,
          new:              enquiries.filter(e => e.status === "NEW").length,
          negotiating:      enquiries.filter(e => e.status === "NEGOTIATING").length,
          agreed:           enquiries.filter(e => e.status === "AGREED").length,
          completed:        enquiries.filter(e => e.status === "COMPLETED").length,
          lost:             enquiries.filter(e => e.status === "LOST").length,
          totalCommission,
        },
      },
    });
  } catch (error) {
    console.error("[enquiryControllers.getAllEnquiries]", {
      userId,
      error: error instanceof Error ? error.message : error,
    });
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};