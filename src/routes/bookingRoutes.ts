// ─────────────────────────────────────────────────────────────────────────────
//  bookingRoutes.ts
//
//  Short stay booking routes for AskDerek.
//
//  Three access levels:
//    Guest   — creates bookings and views their own
//    Manager — confirms check in, check out and no-shows
//    Admin   — views all bookings platform wide
//
//  ROUTE ORDER IS CRITICAL:
//    Static routes must come BEFORE dynamic routes.
//    /my and /admin/all must be registered before /:bookingId/*
//    or Express will match "my" and "admin" as bookingId params.
//
//  clerkMiddleware() is registered globally in index.ts.
//  Role and ownership checks are enforced inside each controller.
// ─────────────────────────────────────────────────────────────────────────────

import { Router }      from "express";
import rateLimit       from "express-rate-limit";
import { requireAuth } from "@clerk/express";
import {
  createBooking,
  cancelBooking,
  checkIn,
  checkOut,
  getGuestBookings,
  getPropertyBookings,
  getAllBookings,
  markNoShow,
} from "../controllers/bookingControllers";

const router = Router();

// ── RATE LIMITERS ─────────────────────────────────────────────────────────────

// Booking creation — max 10 per 15 minutes per IP
// Prevents booking spam and system abuse
const createBookingLimiter = rateLimit({
  windowMs:        15 * 60 * 1000,
  max:             10,
  standardHeaders: true,
  legacyHeaders:   false,
  message:         { success: false, message: "Too many booking attempts. Please slow down." },
});

// General read and update actions
const generalLimiter = rateLimit({
  windowMs:        15 * 60 * 1000,
  max:             100,
  standardHeaders: true,
  legacyHeaders:   false,
  message:         { success: false, message: "Too many requests. Please slow down." },
});

// Admin view actions
const adminLimiter = rateLimit({
  windowMs:        15 * 60 * 1000,
  max:             50,
  standardHeaders: true,
  legacyHeaders:   false,
  message:         { success: false, message: "Too many requests. Please slow down." },
});

// ── STATIC ROUTES — registered before dynamic ─────────────────────────────────

// Guest views all their own bookings
router.get("/my",                   requireAuth(), generalLimiter,       getGuestBookings);

// Admin views all bookings platform wide — paginated
router.get("/admin/all",            requireAuth(), adminLimiter,         getAllBookings);

// Manager views all bookings for a specific property they own
router.get("/property/:propertyId", requireAuth(), generalLimiter,       getPropertyBookings);

// Guest creates a new short stay booking
router.post("/",                    requireAuth(), createBookingLimiter, createBooking);

// ── DYNAMIC ROUTES — registered after static ──────────────────────────────────

// Guest cancels their booking — only allowed before check in
router.put("/:bookingId/cancel",   requireAuth(), generalLimiter, cancelBooking);

// Manager confirms guest has arrived at property
router.put("/:bookingId/checkin",  requireAuth(), generalLimiter, checkIn);

// Manager confirms guest has vacated property
router.put("/:bookingId/checkout", requireAuth(), generalLimiter, checkOut);

// Manager marks booking as no-show — only after check in time passed
router.put("/:bookingId/no-show",  requireAuth(), generalLimiter, markNoShow);

export default router;