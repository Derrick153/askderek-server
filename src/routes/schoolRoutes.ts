// ─────────────────────────────────────────────────────────────────────────────
//  schoolRoutes.ts
//
//  School and semester management routes for AskDerek.
//
//  Two access levels:
//    Public — view schools and semesters — no auth required
//    Admin  — add · update · remove · notify — Derek only
//
//  ROUTE ORDER IS CRITICAL:
//    1. Exact static routes first — GET / and POST /
//    2. Nested semester routes — /:schoolId/semesters/*
//    3. Dynamic school routes last — /:schoolId
//
//  Registering POST / after /:schoolId/semesters causes Express
//  to potentially match POST / as POST /:schoolId/semesters.
//  Always register more specific routes before less specific ones.
//
//  Admin role verified inside each controller via database check.
//  clerkMiddleware() registered globally in index.ts.
// ─────────────────────────────────────────────────────────────────────────────

import { Router }      from "express";
import rateLimit       from "express-rate-limit";
import { requireAuth } from "@clerk/express";
import {
  getAllSchools,
  getSchoolById,
  addSchool,
  addSemester,
  updateSemesterEndDate,
  notifyAllStudents,
  getSemesterStatus,
  removeSchool,
} from "../controllers/schoolControllers";

const router = Router();

// ── RATE LIMITERS ─────────────────────────────────────────────────────────────

// Public routes — slightly stricter to prevent scraping
const publicLimiter = rateLimit({
  windowMs:        15 * 60 * 1000,
  max:             60,
  standardHeaders: true,
  legacyHeaders:   false,
  message:         { success: false, message: "Too many requests. Please slow down." },
});

// Admin action routes — all destructive admin actions
const adminLimiter = rateLimit({
  windowMs:        15 * 60 * 1000,
  max:             30,
  standardHeaders: true,
  legacyHeaders:   false,
  message:         { success: false, message: "Too many requests. Please slow down." },
});

// ── EXACT STATIC ROUTES FIRST ─────────────────────────────────────────────────
// GET / and POST / must be registered before any /:schoolId routes.
// If POST / is registered after POST /:schoolId/semesters
// Express may never reach addSchool correctly.

// All schools with latest 2 semesters — public
router.get("/",  publicLimiter,                getAllSchools);

// Add a new school — admin only
router.post("/", requireAuth(), adminLimiter,  addSchool);

// ── NESTED SEMESTER ROUTES ────────────────────────────────────────────────────
// All /:schoolId/semesters/* routes registered before /:schoolId
// to prevent Express matching "semesters" as a schoolId param value.

// Add a semester to a school
router.post(
  "/:schoolId/semesters",
  requireAuth(),
  adminLimiter,
  addSemester
);

// Update semester closing date when school announces
router.put(
  "/:schoolId/semesters/:semesterId",
  requireAuth(),
  adminLimiter,
  updateSemesterEndDate
);

// Get full semester status — active student count — admin only
router.get(
  "/:schoolId/semesters/:semesterId/status",
  requireAuth(),
  adminLimiter,
  getSemesterStatus
);

// Bulk notify all students when closing date is confirmed
router.post(
  "/:schoolId/semesters/:semesterId/notify",
  requireAuth(),
  adminLimiter,
  notifyAllStudents
);

// ── DYNAMIC SCHOOL ROUTES LAST ────────────────────────────────────────────────
// Registered after all nested semester routes.
// Express only reaches these if no semester route matched first.

// Single school with full semester history — public
router.get("/:schoolId",    publicLimiter,               getSchoolById);

// Remove a school — admin only — blocked if active bookings exist
router.delete("/:schoolId", requireAuth(), adminLimiter, removeSchool);

export default router;