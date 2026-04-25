// ─────────────────────────────────────────────────────────────────────────────
//  advancePaymentRoutes.ts
//
//  Advance rent payment routes for AskDerek.
//
//  All routes require Clerk authentication.
//  Tenants can only access their own leases — enforced in controller.
//
//  ROUTE ORDER IS CRITICAL:
//    /calculate and /split are static — registered before /:leaseId
//    to prevent Express matching them as leaseId param values.
//
//  clerkMiddleware() registered globally in index.ts.
// ─────────────────────────────────────────────────────────────────────────────

import { Router }      from "express";
import rateLimit       from "express-rate-limit";
import { requireAuth } from "@clerk/express";
import {
  splitAdvancePayment,
  calculateCoverage,
  getPaymentCoverage,
} from "../controllers/advancePaymentControllers";

const router = Router();

// ── RATE LIMITERS ─────────────────────────────────────────────────────────────

// Payment splitting — max 5 per 15 minutes
// Advance payments are large financial operations — strict limit
const splitLimiter = rateLimit({
  windowMs:        15 * 60 * 1000,
  max:             5,
  standardHeaders: true,
  legacyHeaders:   false,
  message:         { success: false, message: "Too many payment attempts. Please slow down." },
});

// Calculation — more lenient — no money involved
const calculateLimiter = rateLimit({
  windowMs:        15 * 60 * 1000,
  max:             30,
  standardHeaders: true,
  legacyHeaders:   false,
  message:         { success: false, message: "Too many requests. Please slow down." },
});

// General read routes
const generalLimiter = rateLimit({
  windowMs:        15 * 60 * 1000,
  max:             100,
  standardHeaders: true,
  legacyHeaders:   false,
  message:         { success: false, message: "Too many requests. Please slow down." },
});

// ── STATIC ROUTES FIRST ───────────────────────────────────────────────────────

// Calculate how many months a given amount covers — no DB writes
router.post("/calculate",         requireAuth(), calculateLimiter, calculateCoverage);

// Split advance payment into monthly records — core action
router.post("/split",             requireAuth(), splitLimiter,     splitAdvancePayment);

// ── DYNAMIC ROUTES AFTER ─────────────────────────────────────────────────────

// Get full payment coverage status for a lease
router.get("/coverage/:leaseId",  requireAuth(), generalLimiter,   getPaymentCoverage);

export default router;