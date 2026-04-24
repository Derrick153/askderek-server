import { Router }      from "express";
import rateLimit       from "express-rate-limit";
import { requireAuth } from "@clerk/express";
import {
  createEnquiry,
  getUserEnquiries,
  getManagerEnquiries,
  markEnquiryAsRead,
  respondToEnquiry,
  updateEnquiryStatus,
  recordDeal,
  recordCompletion,
  archiveEnquiry,
  getAllEnquiries,
} from "../controllers/enquiryControllers";

// ─────────────────────────────────────────────────────────────────────────────
//  enquiryRoutes.ts
//
//  Routes for the AskDerek enquiry and deal pipeline system.
//
//  Buyer   — creates enquiries and views their own
//  Manager — responds to and manages enquiries on their properties
//  Admin   — views all enquiries platform wide
//
//  IMPORTANT — Route ordering:
//    GET /admin/all must come BEFORE GET /:enquiryId
//    or Express will match "admin" as the enquiryId param.
//    GET /my must come BEFORE any /:enquiryId routes.
//    GET /manager must come BEFORE any /:enquiryId routes.
//
//  clerkMiddleware() registered globally in index.ts.
//  Ownership and role checks enforced inside each controller.
// ─────────────────────────────────────────────────────────────────────────────

const router = Router();

// ── RATE LIMITERS ─────────────────────────────────────────────────────────────

// Enquiry creation — prevents spam
// Max 10 new enquiries per 15 minutes per IP
const createEnquiryLimiter = rateLimit({
  windowMs:        15 * 60 * 1000,
  max:             10,
  standardHeaders: true,
  legacyHeaders:   false,
  message:         { success: false, message: "Too many enquiries. Please slow down." },
});

// Read and update actions
const generalLimiter = rateLimit({
  windowMs:        15 * 60 * 1000,
  max:             100,
  standardHeaders: true,
  legacyHeaders:   false,
  message:         { success: false, message: "Too many requests. Please slow down." },
});

// ── STATIC ROUTES FIRST ───────────────────────────────────────────────────────
// These must be registered before /:enquiryId routes.
// Express matches routes top to bottom — if /:enquiryId comes first,
// "/my", "/manager" and "/admin/all" would be matched as params.

// Buyer — view all their own enquiries
router.get("/my",        requireAuth(), generalLimiter, getUserEnquiries);

// Manager — view all enquiries on their properties
router.get("/manager",   requireAuth(), generalLimiter, getManagerEnquiries);

// Admin — view all enquiries platform wide (role verified in controller)
router.get("/admin/all", requireAuth(), generalLimiter, getAllEnquiries);

// Buyer — create a new enquiry
router.post("/",         requireAuth(), createEnquiryLimiter, createEnquiry);

// ── DYNAMIC ROUTES AFTER ─────────────────────────────────────────────────────
// All routes below use /:enquiryId — registered after static routes.

// Manager marks enquiry as read
router.put("/:enquiryId/read",     requireAuth(), generalLimiter, markEnquiryAsRead);

// Manager sends response to buyer
router.put("/:enquiryId/respond",  requireAuth(), generalLimiter, respondToEnquiry);

// Update pipeline status: NEW → CONTACTED → NEGOTIATING → AGREED → LOST
router.put("/:enquiryId/status",   requireAuth(), generalLimiter, updateEnquiryStatus);

// Record agreed price — moves status to AGREED — calculates commission
router.put("/:enquiryId/deal",     requireAuth(), generalLimiter, recordDeal);

// Confirm deal complete — marks property SOLD or RENTED automatically
router.put("/:enquiryId/complete", requireAuth(), generalLimiter, recordCompletion);

// Soft archive — buyer or manager can archive their own enquiry
router.put("/:enquiryId/archive",  requireAuth(), generalLimiter, archiveEnquiry);

export default router;