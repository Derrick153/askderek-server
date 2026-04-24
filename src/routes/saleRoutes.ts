import { Router }      from "express";
import rateLimit       from "express-rate-limit";
import { requireAuth } from "@clerk/express";
import {
  listForSale,
  markAsSold,
  markAsRented,
  archiveProperty,
  unarchiveProperty,
  deletePropertyManager,
  triggerPendingRemoval,
  cancelPendingRemoval,
  restoreProperty,
} from "../controllers/saleControllers";

// ─────────────────────────────────────────────────────────────────────────────
//  saleRoutes.ts
//
//  Routes for the property sale lifecycle on AskDerek.
//
//  Manager routes — landlord managing their own properties
//  Admin routes   — Derek with full platform control
//
//  clerkMiddleware() is registered globally in index.ts.
//  requireAuth() here ensures only authenticated users reach controllers.
//  Role and ownership checks happen inside each controller.
// ─────────────────────────────────────────────────────────────────────────────

const router = Router();

// ── RATE LIMITERS ─────────────────────────────────────────────────────────────

// Admin destructive actions — strictly limited
// Prevents mass-deletion even if an admin token is compromised
const adminActionLimiter = rateLimit({
  windowMs:        15 * 60 * 1000,
  max:             20,
  standardHeaders: true,
  legacyHeaders:   false,
  message:         { success: false, message: "Too many requests. Please slow down." },
});

// Manager actions — more lenient
const managerActionLimiter = rateLimit({
  windowMs:        15 * 60 * 1000,
  max:             50,
  standardHeaders: true,
  legacyHeaders:   false,
  message:         { success: false, message: "Too many requests. Please slow down." },
});

// ── MANAGER ROUTES ────────────────────────────────────────────────────────────

// Convert listing to FOR_SALE with asking price
router.put("/list/:propertyId",      requireAuth(), managerActionLimiter, listForSale);

// Record completed sale — calculates 5% commission automatically
router.put("/sold/:propertyId",      requireAuth(), managerActionLimiter, markAsSold);

// Mark as rented — requires active lease to exist
router.put("/rented/:propertyId",    requireAuth(), managerActionLimiter, markAsRented);

// Archive — hides from search — all data preserved
router.put("/archive/:propertyId",   requireAuth(), managerActionLimiter, archiveProperty);

// Unarchive — restores to AVAILABLE
router.put("/unarchive/:propertyId", requireAuth(), managerActionLimiter, unarchiveProperty);

// True delete — only allowed when zero financial history exists
// Registered last to avoid catching other DELETE routes
router.delete("/:propertyId",        requireAuth(), managerActionLimiter, deletePropertyManager);

// ── ADMIN ROUTES ──────────────────────────────────────────────────────────────
// Admin role is verified inside each controller via database check.
// JWT alone is not trusted for admin actions.

// Start 10 minute pending removal countdown
router.put("/pending-removal/:propertyId", requireAuth(), adminActionLimiter, triggerPendingRemoval);

// Cancel pending removal within undo window
router.put("/cancel-removal/:propertyId",  requireAuth(), adminActionLimiter, cancelPendingRemoval);

// Restore soft-deleted or archived property
router.put("/restore/:propertyId",         requireAuth(), adminActionLimiter, restoreProperty);

export default router;