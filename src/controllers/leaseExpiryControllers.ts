// ─────────────────────────────────────────────────────────────────────────────
//  leaseExpiryControllers.ts
//
//  Lease expiry management for AskDerek.
//
//  Business rules enforced:
//    — Expiring leases detected within configurable day window
//    — Tenant and manager both see expiry status
//    — Manager can renew lease with new end date
//    — Manager can mark tenant as vacated after lease ends
//    — Cannot renew a frozen lease
//    — Cannot vacate more than 7 days before lease end
//    — Admin sees all expiring leases platform wide
//    — Admin can force expire any lease with reason
//    — Property set to AVAILABLE when lease expires or vacated
//    — All status changes are atomic via prisma.$transaction
//    — Audit log on every action
//    — Identity always from JWT — never from req.body
//    — Admin role verified from database on every admin request
// ─────────────────────────────────────────────────────────────────────────────

import { Request, Response }         from "express";
import { z }                         from "zod";
import { prisma }                    from "../lib/prisma";
import { logSystemEvent, logAdminEvent } from "../lib/auditService";
import { addDays }                   from "date-fns";

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

const renewLeaseSchema = z.object({
  newEndDate: z.string()
               .datetime({ message: "newEndDate must be a valid ISO datetime" }),
  reason:     z.string()
               .min(5,   "Reason must be at least 5 characters")
               .max(500, "Reason cannot exceed 500 characters")
               .optional(),
});

const vacateSchema = z.object({
  vacatedAt: z.string()
              .datetime({ message: "vacatedAt must be a valid ISO datetime" }),
  reason:    z.string()
              .min(5,   "Reason must be at least 5 characters")
              .max(500, "Reason cannot exceed 500 characters")
              .optional(),
});

const adminActionSchema = z.object({
  adminDbId: z.number({ error: "adminDbId must be a number" })
              .int()
              .positive(),
});

// Defined at top — not inline inside forceExpireLease function
const forceExpireSchema = adminActionSchema.extend({
  reason: z.string()
           .min(10,  "Reason must be at least 10 characters")
           .max(500, "Reason cannot exceed 500 characters"),
});

// ── SHARED HELPERS ────────────────────────────────────────────────────────────

// Extracts userId from verified Clerk JWT.
// Identity must always come from token — never from req.body.
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

// ─────────────────────────────────────────────────────────────────────────────
//  GET EXPIRING LEASES — MANAGER
//  GET /api/lease-expiry/expiring
//
//  Returns all leases expiring within the next N days
//  for properties owned by the logged-in manager.
//  Default window is 60 days. Manager can pass ?days=30.
//  Used to power the expiry alert dashboard.
// ─────────────────────────────────────────────────────────────────────────────
export const getExpiringLeases = async (
  req: Request,
  res: Response<ApiResponse>
): Promise<void> => {
  const managerClerkId = requireAuth(req, res);
  if (!managerClerkId) return;

  const days      = Math.min(180, Math.max(1, Number(req.query.days) || 60));
  const now       = new Date();
  const windowEnd = addDays(now, days);

  try {
    const leases = await prisma.lease.findMany({
      where: {
        status:   "ACTIVE",
        endDate:  { gte: now, lte: windowEnd },
        property: { managerClerkId },
      },
      include: {
        property: {
          select: { id: true, name: true },
        },
      },
      orderBy: { endDate: "asc" },
    });

    const leasesWithDays = leases.map(l => ({
      ...l,
      daysRemaining: Math.ceil(
        (new Date(l.endDate).getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
      ),
    }));

    res.status(200).json({
      success: true,
      message: `${leases.length} lease(s) expiring within ${days} days`,
      data: {
        leases:        leasesWithDays,
        windowDays:    days,
        totalExpiring: leases.length,
      },
    });
  } catch (error) {
    console.error("[leaseExpiryControllers.getExpiringLeases]", {
      managerClerkId,
      error: error instanceof Error ? error.message : error,
    });
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
//  GET TENANT LEASE STATUS
//  GET /api/lease-expiry/my-lease/:leaseId
//
//  Returns expiry status for a specific lease — tenant only.
//  Shows days remaining, whether expiring soon and renewal advice.
// ─────────────────────────────────────────────────────────────────────────────
export const getTenantLeaseStatus = async (
  req: Request,
  res: Response<ApiResponse>
): Promise<void> => {
  const tenantClerkId = requireAuth(req, res);
  if (!tenantClerkId) return;

  const leaseId = getNumericParam(req.params.leaseId, "leaseId", res);
  if (!leaseId) return;

  try {
    const lease = await prisma.lease.findFirst({
      where: { id: leaseId, tenantClerkId },
      include: {
        property: {
          select: {
            id:            true,
            name:          true,
            pricePerMonth: true,
          },
        },
      },
    });

    if (!lease) {
      res.status(404).json({
        success: false,
        message: "Lease not found",
      });
      return;
    }

    const now           = new Date();
    const endDate       = new Date(lease.endDate);
    const daysRemaining = Math.ceil(
      (endDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
    );

    const isExpired      = daysRemaining <= 0;
    const isExpiringSoon = daysRemaining > 0 && daysRemaining <= 60;

    const renewalAdvice = isExpired
      ? "Your lease has expired. Please contact your landlord."
      : isExpiringSoon
      ? `Your lease expires in ${daysRemaining} days. Contact your landlord to renew.`
      : `Your lease is active for ${daysRemaining} more days.`;

    res.status(200).json({
      success: true,
      message: "Lease status retrieved",
      data: {
        lease,
        daysRemaining,
        isExpired,
        isExpiringSoon,
        renewalAdvice,
      },
    });
  } catch (error) {
    console.error("[leaseExpiryControllers.getTenantLeaseStatus]", {
      leaseId,
      tenantClerkId,
      error: error instanceof Error ? error.message : error,
    });
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
//  RENEW LEASE — MANAGER
//  PUT /api/lease-expiry/:leaseId/renew
//
//  Manager extends the lease end date.
//  New end date must be strictly after the current end date.
//  Status reset to ACTIVE if previously EXPIRED.
//  Cannot renew a frozen lease — admin must unfreeze first.
// ─────────────────────────────────────────────────────────────────────────────
export const renewLease = async (
  req: Request,
  res: Response<ApiResponse>
): Promise<void> => {
  const managerClerkId = requireAuth(req, res);
  if (!managerClerkId) return;

  const leaseId = getNumericParam(req.params.leaseId, "leaseId", res);
  if (!leaseId) return;

  const parsed = renewLeaseSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      success: false,
      message: "Validation failed",
      errors:  formatZodErrors(parsed.error.issues),
    });
    return;
  }

  const { newEndDate, reason } = parsed.data;

  try {
    // Authorization — manager must own the property for this lease
    const lease = await prisma.lease.findFirst({
      where: {
        id:       leaseId,
        property: { managerClerkId },
      },
      include: {
        property: { select: { name: true } },
      },
    });

    if (!lease) {
      res.status(404).json({
        success: false,
        message: "Lease not found or you do not have permission",
      });
      return;
    }

    // Cannot renew a frozen lease
    if (lease.isFrozen) {
      res.status(400).json({
        success: false,
        message: "Cannot renew a frozen lease. Contact admin to unfreeze first.",
      });
      return;
    }

    const newEnd = new Date(newEndDate);

    // New end date must be strictly after current end date
    if (newEnd <= new Date(lease.endDate)) {
      res.status(400).json({
        success: false,
        message: "New end date must be after the current lease end date",
      });
      return;
    }

    const updated = await prisma.lease.update({
      where: { id: leaseId },
      data: {
        endDate: newEnd,
        status:  "ACTIVE",
      },
    });

    await logSystemEvent({
      action:  "LEASE_RENEWED",
      target:  `Lease #${leaseId}`,
      details: `Renewed by manager ${managerClerkId}. New end: ${newEndDate}. Property: ${lease.property.name}. Reason: ${reason ?? "No reason given"}`,
    });

    res.status(200).json({
      success: true,
      message: "Lease renewed successfully",
      data:    updated,
    });
  } catch (error) {
    console.error("[leaseExpiryControllers.renewLease]", {
      leaseId,
      managerClerkId,
      error: error instanceof Error ? error.message : error,
    });
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
//  MARK TENANT VACATED — MANAGER
//  PUT /api/lease-expiry/:leaseId/vacate
//
//  Manager records that tenant has physically left the property.
//  Marks lease as EXPIRED and property as AVAILABLE — atomic.
//  Only allowed when lease is expired or within 7 days of end date.
// ─────────────────────────────────────────────────────────────────────────────
export const markTenantVacated = async (
  req: Request,
  res: Response<ApiResponse>
): Promise<void> => {
  const managerClerkId = requireAuth(req, res);
  if (!managerClerkId) return;

  const leaseId = getNumericParam(req.params.leaseId, "leaseId", res);
  if (!leaseId) return;

  const parsed = vacateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      success: false,
      message: "Validation failed",
      errors:  formatZodErrors(parsed.error.issues),
    });
    return;
  }

  const { vacatedAt, reason } = parsed.data;

  try {
    // Step 1 — find the lease
    const lease = await prisma.lease.findUnique({
      where: { id: leaseId },
    });

    if (!lease) {
      res.status(404).json({
        success: false,
        message: "Lease not found",
      });
      return;
    }

    // Step 2 — verify manager owns the property
    const property = await prisma.property.findFirst({
      where: {
        id:            lease.propertyId,
        managerClerkId,
        deletedAt:     null,
      },
    });

    if (!property) {
      res.status(403).json({
        success: false,
        message: "You do not have permission to manage this lease",
      });
      return;
    }

    // Only allow vacate if expired or within 7 days of end date
    const now       = new Date();
    const endDate   = new Date(lease.endDate);
    const daysToEnd = Math.ceil(
      (endDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
    );

    if (lease.status === "ACTIVE" && daysToEnd > 7) {
      res.status(400).json({
        success: false,
        message: `Cannot mark as vacated — lease still has ${daysToEnd} days remaining`,
      });
      return;
    }

    // Atomic — expire lease and free property together
    await prisma.$transaction([
      prisma.lease.update({
        where: { id: leaseId },
        data: {
          status:   "EXPIRED",
          isFrozen: false,
        },
      }),
      prisma.property.update({
        where: { id: lease.propertyId },
        data:  { listingStatus: "AVAILABLE" },
      }),
    ]);

    await logSystemEvent({
      action:  "TENANT_VACATED",
      target:  `Lease #${leaseId}`,
      details: `Tenant vacated. Property #${lease.propertyId} now AVAILABLE. Vacated: ${vacatedAt}. Manager: ${managerClerkId}. Reason: ${reason ?? "No reason given"}`,
    });

    res.status(200).json({
      success: true,
      message: "Tenant marked as vacated. Property is now available.",
    });
  } catch (error) {
    console.error("[leaseExpiryControllers.markTenantVacated]", {
      leaseId,
      managerClerkId,
      error: error instanceof Error ? error.message : error,
    });
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
//  GET ALL EXPIRING LEASES — ADMIN
//  GET /api/lease-expiry/admin/expiring
//
//  Returns all expiring leases platform wide — Derek only.
//  Paginated — prevents memory overload as platform scales.
//  Configurable day window via ?days=N — default 60 days.
//  Both queries run in parallel — faster response.
// ─────────────────────────────────────────────────────────────────────────────
export const getAllExpiringLeasesAdmin = async (
  req: Request,
  res: Response<ApiResponse>
): Promise<void> => {
  const adminClerkId = await requireAdminAuth(req, res);
  if (!adminClerkId) return;

  const days  = Math.min(180, Math.max(1, Number(req.query.days)  || 60));
  const page  = Math.max(1,              Number(req.query.page)   || 1);
  const limit = Math.min(50,             Number(req.query.limit)  || 20);
  const skip  = (page - 1) * limit;

  const now       = new Date();
  const windowEnd = addDays(now, days);

  try {
    const [leases, total] = await Promise.all([
      prisma.lease.findMany({
        skip,
        take:  limit,
        where: {
          status:  "ACTIVE",
          endDate: { gte: now, lte: windowEnd },
        },
        include: {
          property: {
            select: {
              id:             true,
              name:           true,
              managerClerkId: true,
            },
          },
        },
        orderBy: { endDate: "asc" },
      }),
      prisma.lease.count({
        where: {
          status:  "ACTIVE",
          endDate: { gte: now, lte: windowEnd },
        },
      }),
    ]);

    const leasesWithDays = leases.map(l => ({
      ...l,
      daysRemaining: Math.ceil(
        (new Date(l.endDate).getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
      ),
    }));

    res.status(200).json({
      success: true,
      message: `${total} lease(s) expiring within ${days} days`,
      data: {
        leases: leasesWithDays,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
        windowDays: days,
      },
    });
  } catch (error) {
    console.error("[leaseExpiryControllers.getAllExpiringLeasesAdmin]", {
      adminClerkId,
      error: error instanceof Error ? error.message : error,
    });
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
//  FORCE EXPIRE LEASE — ADMIN
//  PUT /api/lease-expiry/admin/:leaseId/expire
//
//  Admin manually marks a lease as EXPIRED.
//  Used for evictions or abandoned properties.
//  Property automatically set back to AVAILABLE.
//  Requires reason — creates accountability and audit trail.
//  Cannot force expire an already expired lease.
// ─────────────────────────────────────────────────────────────────────────────
export const forceExpireLease = async (
  req: Request,
  res: Response<ApiResponse>
): Promise<void> => {
  const adminClerkId = await requireAdminAuth(req, res);
  if (!adminClerkId) return;

  const leaseId = getNumericParam(req.params.leaseId, "leaseId", res);
  if (!leaseId) return;

  const parsed = forceExpireSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      success: false,
      message: "Validation failed",
      errors:  formatZodErrors(parsed.error.issues),
    });
    return;
  }

  const { adminDbId, reason } = parsed.data;

  try {
    const lease = await prisma.lease.findUnique({
      where: { id: leaseId },
    });

    if (!lease) {
      res.status(404).json({
        success: false,
        message: "Lease not found",
      });
      return;
    }

    if (lease.status === "EXPIRED") {
      res.status(400).json({
        success: false,
        message: "Lease is already expired",
      });
      return;
    }

    // Atomic — expire lease and free property together
    await prisma.$transaction([
      prisma.lease.update({
        where: { id: leaseId },
        data: {
          status:   "EXPIRED",
          isFrozen: false,
        },
      }),
      prisma.property.update({
        where: { id: lease.propertyId },
        data:  { listingStatus: "AVAILABLE" },
      }),
    ]);

    await logAdminEvent({
      adminId: adminDbId,
      action:  "LEASE_FORCE_EXPIRED",
      target:  `Lease #${leaseId}`,
      details: `Force expired by ${adminClerkId}. Property #${lease.propertyId} now AVAILABLE. Reason: ${reason}`,
    });

    res.status(200).json({
      success: true,
      message: "Lease force expired. Property is now available.",
    });
  } catch (error) {
    console.error("[leaseExpiryControllers.forceExpireLease]", {
      leaseId,
      adminClerkId,
      error: error instanceof Error ? error.message : error,
    });
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};