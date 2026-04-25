// ─────────────────────────────────────────────────────────────────────────────
//  verifyRoutes.ts
//
//  Payment receipt verification routes for AskDerek.
//
//  All routes are PUBLIC — no auth required.
//  Anyone with a valid reference can verify a payment.
//  This is by design — landlords do not have AskDerek accounts.
//
//  ROUTE ORDER IS CRITICAL:
//    /receipt/:reference must come BEFORE /:reference
//    or Express matches "receipt" as the reference param.
//
//  Rate limiting is strict — prevents brute force reference guessing.
// ─────────────────────────────────────────────────────────────────────────────

import { Router }   from "express";
import rateLimit    from "express-rate-limit";
import {
  verifyByReference,
  verifyByBody,
  getReceiptSummary,
} from "../controllers/verifyReceiptControllers";

const router = Router();

// ── RATE LIMITERS ─────────────────────────────────────────────────────────────

// Strict limiter — prevents brute force reference guessing
// Max 20 verification attempts per 15 minutes per IP
const verifyLimiter = rateLimit({
  windowMs:        15 * 60 * 1000,
  max:             20,
  standardHeaders: true,
  legacyHeaders:   false,
  message:         { success: false, message: "Too many verification attempts. Please slow down." },
});

// ── STATIC ROUTES FIRST ───────────────────────────────────────────────────────
// /receipt/:reference must be before /:reference
// to prevent Express matching "receipt" as a reference value

// Get printable receipt summary — tenant use
router.get("/receipt/:reference", verifyLimiter, getReceiptSummary);

// Verify via POST body — for QR code scanners
router.post("/",                  verifyLimiter, verifyByBody);

// ── DYNAMIC ROUTES AFTER ─────────────────────────────────────────────────────

// Verify payment by reference — public — landlord use
router.get("/:reference",         verifyLimiter, verifyByReference);

export default router;