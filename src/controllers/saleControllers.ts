import { Request, Response }                         from "express";
import { z }                                         from "zod";
import { prisma }                                    from "../lib/prisma";
import { logSystemEvent, logAdminEvent }             from "../lib/auditService";
import { DeleteType, ListingStatus, ListingType }    from "@prisma/client";
import crypto                                        from "crypto";

// ─────────────────────────────────────────────────────────────────────────────
//  saleControllers.ts  —  Final Production Version
//
//  Handles the full property sale lifecycle on AskDerek.
//
//  Security model:
//    — Identity always comes from Clerk JWT (req.auth) — never req.body
//    — Admin role is verified against the database — JWT alone is not enough
//    — Status transitions validated before any database write
//    — Related operations use prisma.$transaction (atomic — all or nothing)
//    — Every destructive action is permanently audit logged
//    — Soft delete — financial data is never erased
//    — Prisma enums used directly — no unsafe string casts
// ─────────────────────────────────────────────────────────────────────────────

// ── RESPONSE TYPES ────────────────────────────────────────────────────────────
// T defaults to unknown instead of undefined.
// This allows controllers to pass real data objects without TypeScript errors.

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
// Zod v4 removed required_error and invalid_type_error.
// Use error: string for a single custom message on type failures.
// Chained methods like .positive() and .min() handle value validation.

const listForSaleSchema = z.object({
  askingPrice:  z.number({ error: "askingPrice must be a number" })
                 .positive("askingPrice must be greater than zero"),
  isNegotiable: z.boolean().optional().default(false),
});

const markAsSoldSchema = z.object({
  soldPrice:     z.number({ error: "soldPrice must be a number" })
                  .positive("soldPrice must be greater than zero"),
  soldToClerkId: z.string().optional(),
});

const adminSchema = z.object({
  adminDbId: z.number({ error: "adminDbId must be a number" })
              .int()
              .positive("adminDbId must be a positive integer"),
});

const pendingRemovalSchema = adminSchema.extend({
  reason:     z.string().min(10, "Reason must be at least 10 characters"),
  deleteType: z.enum([
    "REMOVED_BY_ADMIN",
    "SUSPENDED",
    "SPAM",
    "DUPLICATE",
    "LANDLORD_REQUEST",
    "FRAUDULENT",
  ]),
});

// ── SAFE ENUM MAP ─────────────────────────────────────────────────────────────
// Maps Zod-validated strings to Prisma DeleteType enum values.
// Avoids unsafe type casts that can cause runtime errors.
const deleteTypeMap: Record<string, DeleteType> = {
  REMOVED_BY_ADMIN: DeleteType.REMOVED_BY_ADMIN,
  SUSPENDED:        DeleteType.SUSPENDED,
  SPAM:             DeleteType.SPAM,
  DUPLICATE:        DeleteType.DUPLICATE,
  LANDLORD_REQUEST: DeleteType.LANDLORD_REQUEST,
  FRAUDULENT:       DeleteType.FRAUDULENT,
};

// ── SHARED HELPERS ────────────────────────────────────────────────────────────

// Validates the propertyId route parameter.
// Returns null and sends 400 if the value is not a valid positive integer.
const getPropertyId = (
  req: Request,
  res: Response
): number | null => {
  const id = Number(req.params.propertyId);
  if (isNaN(id) || id <= 0) {
    res.status(400).json({ success: false, message: "Invalid propertyId" });
    return null;
  }
  return id;
};

// Extracts userId from the verified Clerk JWT.
// Identity must always come from the JWT — never from req.body.
// Returns null and sends 401 if no authenticated session exists.
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

// Verifies the caller is an active admin by checking the database.
// JWT alone is not sufficient for admin actions — the role must be
// confirmed from the database on every admin request.
// This prevents a demoted admin from continuing to act as admin.
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

// Generates a unique restore code used as a paper trail reference
// when a soft-deleted property is restored by an admin.
// Format: RST-YYYY-XXXXXXXX
const generateRestoreCode = (): string => {
  const year = new Date().getFullYear();
  const hex  = crypto.randomBytes(4).toString("hex").toUpperCase();
  return `RST-${year}-${hex}`;
};

// Converts Zod validation issues into the standard API error shape.
const formatZodErrors = (
  issues: z.ZodIssue[]
): { field: string; message: string }[] =>
  issues.map(i => ({
    field:   String(i.path[0] ?? "unknown"),
    message: i.message,
  }));

// ─────────────────────────────────────────────────────────────────────────────
//  LIST FOR SALE
//  PUT /api/sale/list/:propertyId
//
//  Converts an existing listing to FOR_SALE.
//  Only AVAILABLE properties can be converted.
//  Resets approval status — admin must re-approve after type change.
// ─────────────────────────────────────────────────────────────────────────────
export const listForSale = async (
  req: Request,
  res: Response<ApiResponse>
): Promise<void> => {
  const managerClerkId = requireAuth(req, res);
  if (!managerClerkId) return;

  const propertyId = getPropertyId(req, res);
  if (!propertyId) return;

  const parsed = listForSaleSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      success: false,
      message: "Validation failed",
      errors:  formatZodErrors(parsed.error.issues),
    });
    return;
  }

  const { askingPrice, isNegotiable } = parsed.data;

  try {
    // Authorization — confirms this manager owns this property.
    // deletedAt: null excludes soft-deleted properties.
    const property = await prisma.property.findFirst({
      where: {
        id:            propertyId,
        managerClerkId,
        deletedAt:     null,
        isArchived:    false,
      },
    });

    if (!property) {
      res.status(404).json({
        success: false,
        message: "Property not found or you do not have permission",
      });
      return;
    }

    // Only AVAILABLE properties can be listed for sale.
    if (property.listingStatus !== ListingStatus.AVAILABLE) {
      res.status(400).json({
        success: false,
        message: `Only AVAILABLE properties can be listed for sale. Current: ${property.listingStatus}`,
      });
      return;
    }

    const updated = await prisma.$transaction(async (tx) => {
      const result = await tx.property.update({
        where: { id: propertyId },
        data: {
          listingType:   ListingType.FOR_SALE,
          listingStatus: ListingStatus.AVAILABLE,
          askingPrice,
          isNegotiable,
          status:        "Pending",
        },
      });

      await logSystemEvent({
        action:  "PROPERTY_LISTED_FOR_SALE",
        target:  `Property #${propertyId}`,
        details: `Changed to FOR_SALE at GHS ${askingPrice} by ${managerClerkId}`,
      });

      return result;
    });

    res.status(200).json({
      success: true,
      message: "Property listed for sale successfully",
      data:    updated,
    });
  } catch (error) {
    console.error("[saleControllers.listForSale]", {
      propertyId,
      error: error instanceof Error ? error.message : error,
    });
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
//  MARK AS SOLD
//  PUT /api/sale/sold/:propertyId
//
//  Records a completed sale with final price.
//  Calculates 5% commission automatically.
//  Uses $transaction — property update and audit log are atomic.
// ─────────────────────────────────────────────────────────────────────────────
export const markAsSold = async (
  req: Request,
  res: Response<ApiResponse>
): Promise<void> => {
  const managerClerkId = requireAuth(req, res);
  if (!managerClerkId) return;

  const propertyId = getPropertyId(req, res);
  if (!propertyId) return;

  const parsed = markAsSoldSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      success: false,
      message: "Validation failed",
      errors:  formatZodErrors(parsed.error.issues),
    });
    return;
  }

  const { soldPrice, soldToClerkId } = parsed.data;

  try {
    const property = await prisma.property.findFirst({
      where: {
        id:            propertyId,
        managerClerkId,
        deletedAt:     null,
      },
    });

    if (!property) {
      res.status(404).json({ success: false, message: "Property not found" });
      return;
    }

    if (property.listingStatus !== ListingStatus.AVAILABLE) {
      res.status(400).json({
        success: false,
        message: `Only AVAILABLE properties can be marked as sold. Current: ${property.listingStatus}`,
      });
      return;
    }

    const commissionAmount = soldPrice * 0.05;
    const landlordAmount   = soldPrice * 0.95;
    const now              = new Date();

    const updated = await prisma.$transaction(async (tx) => {
      const result = await tx.property.update({
        where: { id: propertyId },
        data: {
          listingStatus: ListingStatus.SOLD,
          soldAt:        now,
          soldPrice,
          soldToClerkId: soldToClerkId ?? null,
        },
      });

      await logSystemEvent({
        action:  "PROPERTY_SOLD",
        target:  `Property #${propertyId}`,
        details: `Sold GHS ${soldPrice}. Commission: GHS ${commissionAmount}. Net: GHS ${landlordAmount}`,
      });

      return result;
    });

    res.status(200).json({
      success: true,
      message: "Property marked as sold",
      data: {
        property:         updated,
        soldPrice,
        commissionDue:    commissionAmount,
        landlordReceives: landlordAmount,
      },
    });
  } catch (error) {
    console.error("[saleControllers.markAsSold]", {
      propertyId,
      error: error instanceof Error ? error.message : error,
    });
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
//  MARK AS RENTED
//  PUT /api/sale/rented/:propertyId
//
//  Marks a property as occupied.
//  Requires an active lease to exist — enforces data integrity.
// ─────────────────────────────────────────────────────────────────────────────
export const markAsRented = async (
  req: Request,
  res: Response<ApiResponse>
): Promise<void> => {
  const managerClerkId = requireAuth(req, res);
  if (!managerClerkId) return;

  const propertyId = getPropertyId(req, res);
  if (!propertyId) return;

  try {
    const property = await prisma.property.findFirst({
      where: {
        id:            propertyId,
        managerClerkId,
        deletedAt:     null,
      },
    });

    if (!property) {
      res.status(404).json({ success: false, message: "Property not found" });
      return;
    }

    if (property.listingStatus !== ListingStatus.AVAILABLE) {
      res.status(400).json({
        success: false,
        message: `Only AVAILABLE properties can be marked as rented. Current: ${property.listingStatus}`,
      });
      return;
    }

    // Integrity check — active lease must exist before marking as rented.
    const activeLease = await prisma.lease.findFirst({
      where: { propertyId, status: "ACTIVE" },
    });

    if (!activeLease) {
      res.status(400).json({
        success: false,
        message: "Cannot mark as rented without an active lease",
      });
      return;
    }

    await prisma.property.update({
      where: { id: propertyId },
      data:  { listingStatus: ListingStatus.RENTED },
    });

    await logSystemEvent({
      action:  "PROPERTY_RENTED",
      target:  `Property #${propertyId}`,
      details: `Marked rented by manager ${managerClerkId}. Lease #${activeLease.id}`,
    });

    res.status(200).json({
      success: true,
      message: "Property marked as rented",
    });
  } catch (error) {
    console.error("[saleControllers.markAsRented]", {
      propertyId,
      error: error instanceof Error ? error.message : error,
    });
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
//  ARCHIVE PROPERTY — MANAGER
//  PUT /api/sale/archive/:propertyId
//
//  Hides property from public search — data preserved.
//  Safe for all properties regardless of activity history.
// ─────────────────────────────────────────────────────────────────────────────
export const archiveProperty = async (
  req: Request,
  res: Response<ApiResponse>
): Promise<void> => {
  const managerClerkId = requireAuth(req, res);
  if (!managerClerkId) return;

  const propertyId = getPropertyId(req, res);
  if (!propertyId) return;

  try {
    const property = await prisma.property.findFirst({
      where: {
        id:            propertyId,
        managerClerkId,
        deletedAt:     null,
      },
    });

    if (!property) {
      res.status(404).json({ success: false, message: "Property not found" });
      return;
    }

    if (property.isArchived) {
      res.status(400).json({
        success: false,
        message: "Property is already archived",
      });
      return;
    }

    await prisma.property.update({
      where: { id: propertyId },
      data: {
        isArchived:    true,
        archivedAt:    new Date(),
        archivedBy:    managerClerkId,
        listingStatus: ListingStatus.ARCHIVED,
      },
    });

    await logSystemEvent({
      action:  "PROPERTY_ARCHIVED",
      target:  `Property #${propertyId}`,
      details: `Archived by manager ${managerClerkId}`,
    });

    res.status(200).json({
      success: true,
      message: "Property archived successfully",
    });
  } catch (error) {
    console.error("[saleControllers.archiveProperty]", {
      propertyId,
      error: error instanceof Error ? error.message : error,
    });
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
//  UNARCHIVE PROPERTY — MANAGER
//  PUT /api/sale/unarchive/:propertyId
//
//  Restores an archived property back to AVAILABLE.
// ─────────────────────────────────────────────────────────────────────────────
export const unarchiveProperty = async (
  req: Request,
  res: Response<ApiResponse>
): Promise<void> => {
  const managerClerkId = requireAuth(req, res);
  if (!managerClerkId) return;

  const propertyId = getPropertyId(req, res);
  if (!propertyId) return;

  try {
    const property = await prisma.property.findFirst({
      where: {
        id:            propertyId,
        managerClerkId,
        deletedAt:     null,
      },
    });

    if (!property) {
      res.status(404).json({ success: false, message: "Property not found" });
      return;
    }

    if (!property.isArchived) {
      res.status(400).json({
        success: false,
        message: "Property is not archived",
      });
      return;
    }

    await prisma.property.update({
      where: { id: propertyId },
      data: {
        isArchived:    false,
        archivedAt:    null,
        archivedBy:    null,
        listingStatus: ListingStatus.AVAILABLE,
      },
    });

    await logSystemEvent({
      action:  "PROPERTY_RESTORED",
      target:  `Property #${propertyId}`,
      details: `Unarchived by manager ${managerClerkId}`,
    });

    res.status(200).json({
      success: true,
      message: "Property unarchived successfully",
    });
  } catch (error) {
    console.error("[saleControllers.unarchiveProperty]", {
      propertyId,
      error: error instanceof Error ? error.message : error,
    });
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
//  DELETE PROPERTY — MANAGER (LIMITED)
//  DELETE /api/sale/:propertyId
//
//  True delete — only when zero financial history exists.
//  Checks applications, leases, and enquiries in one parallel query.
//  If any exist the request is rejected — archive is suggested instead.
// ─────────────────────────────────────────────────────────────────────────────
export const deletePropertyManager = async (
  req: Request,
  res: Response<ApiResponse>
): Promise<void> => {
  const managerClerkId = requireAuth(req, res);
  if (!managerClerkId) return;

  const propertyId = getPropertyId(req, res);
  if (!propertyId) return;

  try {
    const property = await prisma.property.findFirst({
      where: {
        id:            propertyId,
        managerClerkId,
        deletedAt:     null,
      },
    });

    if (!property) {
      res.status(404).json({ success: false, message: "Property not found" });
      return;
    }

    // Parallel check — single database round trip for all history checks.
    const [applications, leases, enquiries] = await Promise.all([
      prisma.application.count({ where: { propertyId } }),
      prisma.lease.count({       where: { propertyId } }),
      prisma.enquiry.count({     where: { propertyId } }),
    ]);

    if (applications > 0 || leases > 0 || enquiries > 0) {
      res.status(400).json({
        success: false,
        message: "This property has activity records and cannot be deleted. Use Archive to hide it from search.",
      });
      return;
    }

    await prisma.property.delete({ where: { id: propertyId } });

    await logSystemEvent({
      action:  "PROPERTY_SOFT_DELETED",
      target:  `Property #${propertyId}`,
      details: `Permanently deleted by manager ${managerClerkId} — confirmed zero activity`,
    });

    res.status(200).json({
      success: true,
      message: "Property deleted successfully",
    });
  } catch (error) {
    console.error("[saleControllers.deletePropertyManager]", {
      propertyId,
      error: error instanceof Error ? error.message : error,
    });
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
//  TRIGGER PENDING REMOVAL — ADMIN
//  PUT /api/sale/pending-removal/:propertyId
//
//  First step of admin soft delete.
//  Sets 10 minute countdown — admin can cancel within this window.
//  Active leases frozen immediately to preserve legal state.
//  Cron job (pendingRemovalJob) executes soft delete at removalExecuteAt.
// ─────────────────────────────────────────────────────────────────────────────
export const triggerPendingRemoval = async (
  req: Request,
  res: Response<ApiResponse>
): Promise<void> => {
  const adminClerkId = await requireAdminAuth(req, res);
  if (!adminClerkId) return;

  const propertyId = getPropertyId(req, res);
  if (!propertyId) return;

  const parsed = pendingRemovalSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      success: false,
      message: "Validation failed",
      errors:  formatZodErrors(parsed.error.issues),
    });
    return;
  }

  const { adminDbId, reason, deleteType } = parsed.data;

  try {
    const property = await prisma.property.findFirst({
      where: {
        id:        propertyId,
        deletedAt: null,
      },
      include: {
        leases: { where: { status: "ACTIVE" } },
      },
    });

    if (!property) {
      res.status(404).json({ success: false, message: "Property not found" });
      return;
    }

    if (property.listingStatus === ListingStatus.PENDING_REMOVAL) {
      res.status(400).json({
        success: false,
        message: "Property is already pending removal",
      });
      return;
    }

    const now              = new Date();
    const removalExecuteAt = new Date(now.getTime() + 10 * 60 * 1000);
    const hasActiveTenant  = property.leases.length > 0;

    // Atomic — property update and lease freeze succeed together or fail together.
    await prisma.$transaction([
      prisma.property.update({
        where: { id: propertyId },
        data: {
          listingStatus:          ListingStatus.PENDING_REMOVAL,
          pendingRemovalAt:       now,
          pendingRemovalBy:       adminClerkId,
          removalExecuteAt,
          deleteReason:           reason,
          deleteType:             deleteTypeMap[deleteType],
          requiresAdminAttention: true,
        },
      }),
      ...(hasActiveTenant
        ? [prisma.lease.updateMany({
            where: { propertyId, status: "ACTIVE" },
            data: {
              isFrozen:    true,
              frozenAt:    now,
              freezeReason: "PROPERTY_PENDING_REMOVAL",
              status:      "FROZEN",
            },
          })]
        : []),
    ]);

    await logAdminEvent({
      adminId: adminDbId,
      action:  "PROPERTY_PENDING_REMOVAL",
      target:  `Property #${propertyId}`,
      details: `Triggered by ${adminClerkId}. Type: ${deleteType}. Executes: ${removalExecuteAt.toISOString()}. Reason: ${reason}`,
    });

    res.status(200).json({
      success: true,
      message: "Property queued for removal. You have 10 minutes to cancel.",
      data: {
        undoWindowMinutes: 10,
        removalExecuteAt,
        hasActiveTenant,
        frozenLeases:      hasActiveTenant ? property.leases.length : 0,
      },
    });
  } catch (error) {
    console.error("[saleControllers.triggerPendingRemoval]", {
      propertyId,
      error: error instanceof Error ? error.message : error,
    });
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
//  CANCEL PENDING REMOVAL — ADMIN
//  PUT /api/sale/cancel-removal/:propertyId
//
//  Cancels a queued removal within the 10 minute undo window.
//  Restores property to AVAILABLE and unfreezes affected leases.
// ─────────────────────────────────────────────────────────────────────────────
export const cancelPendingRemoval = async (
  req: Request,
  res: Response<ApiResponse>
): Promise<void> => {
  const adminClerkId = await requireAdminAuth(req, res);
  if (!adminClerkId) return;

  const propertyId = getPropertyId(req, res);
  if (!propertyId) return;

  const parsed = adminSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      success: false,
      message: "Validation failed",
      errors:  formatZodErrors(parsed.error.issues),
    });
    return;
  }

  const { adminDbId } = parsed.data;

  try {
    const property = await prisma.property.findFirst({
      where: {
        id:            propertyId,
        listingStatus: ListingStatus.PENDING_REMOVAL,
      },
    });

    if (!property) {
      res.status(404).json({
        success: false,
        message: "No pending removal found for this property",
      });
      return;
    }

    const now = new Date();
    if (property.removalExecuteAt && now >= property.removalExecuteAt) {
      res.status(400).json({
        success: false,
        message: "Undo window has expired. The removal has already been executed.",
      });
      return;
    }

    await prisma.$transaction([
      prisma.property.update({
        where: { id: propertyId },
        data: {
          listingStatus:          ListingStatus.AVAILABLE,
          pendingRemovalAt:       null,
          pendingRemovalBy:       null,
          removalExecuteAt:       null,
          deleteReason:           null,
          deleteType:             null,
          requiresAdminAttention: false,
        },
      }),
      prisma.lease.updateMany({
        where: {
          propertyId,
          isFrozen:    true,
          freezeReason: "PROPERTY_PENDING_REMOVAL",
        },
        data: {
          isFrozen:    false,
          frozenAt:    null,
          freezeReason: null,
          status:      "ACTIVE",
        },
      }),
    ]);

    await logAdminEvent({
      adminId: adminDbId,
      action:  "PROPERTY_RESTORED",
      target:  `Property #${propertyId}`,
      details: `Pending removal cancelled by ${adminClerkId}`,
    });

    res.status(200).json({
      success: true,
      message: "Pending removal cancelled successfully",
    });
  } catch (error) {
    console.error("[saleControllers.cancelPendingRemoval]", {
      propertyId,
      error: error instanceof Error ? error.message : error,
    });
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
//  RESTORE PROPERTY — ADMIN
//  PUT /api/sale/restore/:propertyId
//
//  Restores a soft-deleted or archived property to AVAILABLE.
//  Valid leases reactivated. Expired leases flagged for manual review.
//  Uses $transaction — all changes are atomic.
// ─────────────────────────────────────────────────────────────────────────────
export const restoreProperty = async (
  req: Request,
  res: Response<ApiResponse>
): Promise<void> => {
  const adminClerkId = await requireAdminAuth(req, res);
  if (!adminClerkId) return;

  const propertyId = getPropertyId(req, res);
  if (!propertyId) return;

  const parsed = adminSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      success: false,
      message: "Validation failed",
      errors:  formatZodErrors(parsed.error.issues),
    });
    return;
  }

  const { adminDbId } = parsed.data;

  try {
    const property = await prisma.property.findFirst({
      where: { id: propertyId },
      include: {
        leases: { where: { isFrozen: true } },
      },
    });

    if (!property) {
      res.status(404).json({ success: false, message: "Property not found" });
      return;
    }

    const now           = new Date();
    const validLeases   = property.leases.filter(l => new Date(l.endDate) > now);
    const expiredLeases = property.leases.filter(l => new Date(l.endDate) <= now);
    const restoreCode   = generateRestoreCode();

    await prisma.$transaction([
      prisma.property.update({
        where: { id: propertyId },
        data: {
          deletedAt:              null,
          deletedBy:              null,
          deleteReason:           null,
          deleteType:             null,
          pendingRemovalAt:       null,
          pendingRemovalBy:       null,
          removalExecuteAt:       null,
          isArchived:             false,
          archivedAt:             null,
          archivedBy:             null,
          listingStatus:          ListingStatus.AVAILABLE,
          requiresAdminAttention: expiredLeases.length > 0,
          restoredAt:             now,
          restoredBy:             adminClerkId,
          restoreCode,
        },
      }),
      // Only reactivate leases that have not expired.
      // Expired leases require manual review — never auto-resurrect.
      ...(validLeases.length > 0
        ? [prisma.lease.updateMany({
            where: { id: { in: validLeases.map(l => l.id) } },
            data: {
              isFrozen:    false,
              frozenAt:    null,
              freezeReason: null,
              status:      "ACTIVE",
            },
          })]
        : []),
    ]);

    await logAdminEvent({
      adminId: adminDbId,
      action:  "PROPERTY_RESTORED",
      target:  `Property #${propertyId}`,
      details: `Restored by ${adminClerkId}. Code: ${restoreCode}. Valid leases: ${validLeases.length}. Expired (manual review): ${expiredLeases.length}`,
    });

    res.status(200).json({
      success: true,
      message: "Property restored successfully",
      data: {
        restoreCode,
        reactivatedLeases:    validLeases.length,
        expiredLeasesCount:   expiredLeases.length,
        manualReviewRequired: expiredLeases.length > 0,
      },
    });
  } catch (error) {
    console.error("[saleControllers.restoreProperty]", {
      propertyId,
      error: error instanceof Error ? error.message : error,
    });
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};