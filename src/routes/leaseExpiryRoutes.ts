// ─────────────────────────────────────────────────────────────────────────────
//  leaseExpiryRoutes.ts
//
//  Lease expiry management routes for AskDerek.
//
//  Three access levels:
//    Tenant  — views their own lease status
//    Manager — views expiring leases · renews · marks vacated
//    Admin   — views all expiring leases · force expires
//
//  ROUTE ORDER IS CRITICAL:
//    Static routes (/expiring · /admin/expiring · /my-lease/:id)
//    must come BEFORE dynamic routes (/:leaseId/*)
//    to prevent Express matching static segments as leaseId params.
//
//  clerkMiddleware() registered globally in index.ts.
//  Role and ownership checks enforced inside each controller.
// ─────────────────────────────────────────────────────────────────────────────

import { Router }      from "express";
import rateLimit       from "express-rate-limit";
import { requireAuth } from "@clerk/express";
import {
  getExpiringLeases,
  getTenantLeaseStatus,
  renewLease,
  markTenantVacated,
  getAllExpiringLeasesAdmin,
  forceExpireLease,
} from "../controllers/leaseExpiryControllers";

const router = Router();

// ── RATE LIMITERS ─────────────────────────────────────────────────────────────

const generalLimiter = rateLimit({
  windowMs:        15 * 60 * 1000,
  max:             100,
  standardHeaders: true,
  legacyHeaders:   false,
  message:         { success: false, message: "Too many requests. Please slow down." },
});

const adminLimiter = rateLimit({
  windowMs:        15 * 60 * 1000,
  max:             50,
  standardHeaders: true,
  legacyHeaders:   false,
  message:         { success: false, message: "Too many requests. Please slow down." },
});

const actionLimiter = rateLimit({
  windowMs:        15 * 60 * 1000,
  max:             20,
  standardHeaders: true,
  legacyHeaders:   false,
  message:         { success: false, message: "Too many requests. Please slow down." },
});

// ── STATIC ROUTES FIRST ───────────────────────────────────────────────────────

// Manager views their expiring leases — configurable day window
router.get("/expiring",                  requireAuth(), generalLimiter, getExpiringLeases);

// Admin views all expiring leases platform wide — paginated
router.get("/admin/expiring",            requireAuth(), adminLimiter,   getAllExpiringLeasesAdmin);

// Tenant views their own lease expiry status
router.get("/my-lease/:leaseId",         requireAuth(), generalLimiter, getTenantLeaseStatus);

// ── DYNAMIC ROUTES AFTER ─────────────────────────────────────────────────────

// Manager renews a lease with new end date
router.put("/:leaseId/renew",            requireAuth(), actionLimiter,  renewLease);

// Manager marks tenant as vacated after lease ends
router.put("/:leaseId/vacate",           requireAuth(), actionLimiter,  markTenantVacated);

// Admin force expires a lease — eviction or abandonment
router.put("/admin/:leaseId/expire",     requireAuth(), adminLimiter,   forceExpireLease);

export default router;