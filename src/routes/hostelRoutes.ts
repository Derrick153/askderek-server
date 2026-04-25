// ─────────────────────────────────────────────────────────────────────────────
//  hostelRoutes.ts
//
//  Hostel booking routes for AskDerek.
//
//  Three access levels:
//    Student  — creates bookings and views their own
//    Manager  — manages rooms · checkout · extensions
//    Admin    — views all hostel bookings platform wide
//
//  ROUTE ORDER IS CRITICAL:
//    Static routes (/my · /admin/all · /book · /property/:id
//    · /availability/:propertyId) must come BEFORE dynamic
//    routes (/:bookingId/*) to prevent Express matching
//    static path segments as bookingId param values.
//
//  getRoomAvailability is public — no requireAuth needed.
//  All other routes require Clerk authentication.
//  clerkMiddleware() registered globally in index.ts.
//  Role and ownership checks enforced inside each controller.
// ─────────────────────────────────────────────────────────────────────────────

import { Router }      from "express";
import rateLimit       from "express-rate-limit";
import { requireAuth } from "@clerk/express";
import {
  createSemesterBooking,
  getStudentBookings,
  getHostelBookings,
  checkoutStudent,
  extendStay,
  getRoomAvailability,
  getAllHostelBookings,
} from "../controllers/hostelControllers";

const router = Router();

// ── RATE LIMITERS ─────────────────────────────────────────────────────────────

// Booking creation — max 10 per 15 minutes per IP
// Prevents booking spam on hostel listings
const createBookingLimiter = rateLimit({
  windowMs:        15 * 60 * 1000,
  max:             10,
  standardHeaders: true,
  legacyHeaders:   false,
  message:         { success: false, message: "Too many booking attempts. Please slow down." },
});

// General authenticated read and update routes
const generalLimiter = rateLimit({
  windowMs:        15 * 60 * 1000,
  max:             100,
  standardHeaders: true,
  legacyHeaders:   false,
  message:         { success: false, message: "Too many requests. Please slow down." },
});

// Public availability route — slightly stricter to prevent scraping
const publicLimiter = rateLimit({
  windowMs:        15 * 60 * 1000,
  max:             60,
  standardHeaders: true,
  legacyHeaders:   false,
  message:         { success: false, message: "Too many requests. Please slow down." },
});

// Admin view routes
const adminLimiter = rateLimit({
  windowMs:        15 * 60 * 1000,
  max:             50,
  standardHeaders: true,
  legacyHeaders:   false,
  message:         { success: false, message: "Too many requests. Please slow down." },
});

// ── STATIC ROUTES FIRST ───────────────────────────────────────────────────────
// All static and named routes registered before dynamic /:bookingId routes.
// Express matches routes top to bottom — order is critical here.

// Student views all their own hostel bookings
router.get("/my",                         requireAuth(), generalLimiter,       getStudentBookings);

// Admin views all hostel bookings platform wide — paginated
router.get("/admin/all",                  requireAuth(), adminLimiter,         getAllHostelBookings);

// Manager views all bookings for their specific hostel property
router.get("/property/:propertyId",       requireAuth(), generalLimiter,       getHostelBookings);

// Public — room availability for a hostel
// No requireAuth — prospective students browse before signing up
// Renamed from /:propertyId/availability to /availability/:propertyId
// to avoid ambiguity with /:bookingId dynamic routes below
router.get("/availability/:propertyId",   publicLimiter,                       getRoomAvailability);

// Student creates a new semester or monthly hostel booking
router.post("/book",                      requireAuth(), createBookingLimiter, createSemesterBooking);

// ── DYNAMIC ROUTES AFTER ─────────────────────────────────────────────────────
// All /:bookingId routes registered after all static routes.
// Express will only reach these if no static route matched first.

// Manager records student checkout — sets actualEndDate
router.put("/:bookingId/checkout",        requireAuth(), generalLimiter,       checkoutStudent);

// Manager extends student stay beyond original end date
router.put("/:bookingId/extend",          requireAuth(), generalLimiter,       extendStay);

export default router;