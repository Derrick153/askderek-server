// ─────────────────────────────────────────────────────────────────────────────
//  schoolControllers.ts
//
//  School and semester management for AskDerek hostel system.
//
//  Business rules enforced:
//    — Only admin can add, update or remove schools
//    — Only admin can update semester closing dates
//    — When closing date confirmed — all linked students notified via SMS
//    — School name must be unique — no duplicates
//    — Semester name must be unique per school — no duplicates
//    — Semester end date must be after start date
//    — Semester must be confirmed before students can be notified
//    — School cannot be removed if active student bookings exist
//    — Admin role verified from database on every admin request
//    — Public endpoints allow anyone to view schools and semesters
//
//  Note: notifyAllStudents logs the notification event.
//  Actual SMS dispatch will be wired in Phase 4 via notificationService.
// ─────────────────────────────────────────────────────────────────────────────

import { Request, Response } from "express";
import { z }                 from "zod";
import { prisma }            from "../lib/prisma";
import { logAdminEvent }     from "../lib/auditService";

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
// adminActionSchema is the base — extended by schemas that need adminDbId.
// This prevents duplication and keeps adminDbId validation consistent.

const adminActionSchema = z.object({
  adminDbId: z.number({ error: "adminDbId must be a number" })
              .int()
              .positive(),
});

const addSchoolSchema = adminActionSchema.extend({
  name:     z.string()
             .min(2,   "School name must be at least 2 characters")
             .max(100, "School name cannot exceed 100 characters"),
  location: z.string()
             .min(2,   "Location must be at least 2 characters")
             .max(100, "Location cannot exceed 100 characters"),
});

const addSemesterSchema = adminActionSchema.extend({
  semesterName: z.string()
                 .min(3,   "Semester name must be at least 3 characters")
                 .max(100, "Semester name cannot exceed 100 characters"),
  startDate:    z.string()
                 .datetime({ message: "startDate must be a valid ISO datetime" }),
});

const updateSemesterEndDateSchema = adminActionSchema.extend({
  endDate: z.string()
            .datetime({ message: "endDate must be a valid ISO datetime" }),
});

const notifyStudentsSchema = adminActionSchema.extend({
  message: z.string()
            .min(10,  "Message must be at least 10 characters")
            .max(160, "SMS message cannot exceed 160 characters")
            .optional(),
});

// ── SHARED HELPERS ────────────────────────────────────────────────────────────

// Verifies caller is an active admin via database check.
// JWT alone is not trusted for admin actions — role confirmed every request.
// Prevents demoted admins from continuing to act as admin.
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
// Returns null and sends 400 if value is not a valid positive integer.
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

// Formats a date to a reliable ISO date string — "2026-08-15"
// Avoids toLocaleDateString which behaves differently across server OS versions.
const formatDate = (date: Date): string =>
  date.toISOString().split("T")[0];

// ─────────────────────────────────────────────────────────────────────────────
//  GET ALL SCHOOLS
//  GET /api/schools
//
//  Returns all schools registered on AskDerek.
//  Public endpoint — no auth required.
//  Includes the 2 most recent semesters per school for quick display.
//  Used by students when booking SCHOOL_CALENDAR type hostels.
// ─────────────────────────────────────────────────────────────────────────────
export const getAllSchools = async (
  req: Request,
  res: Response<ApiResponse>
): Promise<void> => {
  try {
    const schools = await prisma.school.findMany({
      include: {
        semesters: {
          orderBy: { startDate: "desc" },
          take:    2,
          select: {
            id:           true,
            semesterName: true,
            startDate:    true,
            endDate:      true,
            isConfirmed:  true,
          },
        },
      },
      orderBy: { name: "asc" },
    });

    res.status(200).json({
      success: true,
      message: "Schools retrieved successfully",
      data:    schools,
    });
  } catch (error) {
    console.error("[schoolControllers.getAllSchools]", {
      error: error instanceof Error ? error.message : error,
    });
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
//  GET SCHOOL BY ID
//  GET /api/schools/:schoolId
//
//  Returns a single school with full semester history.
//  Public endpoint — no auth required.
//  Used by students to check a school's past and current semester dates.
// ─────────────────────────────────────────────────────────────────────────────
export const getSchoolById = async (
  req: Request,
  res: Response<ApiResponse>
): Promise<void> => {
  const schoolId = getNumericParam(req.params.schoolId, "schoolId", res);
  if (!schoolId) return;

  try {
    const school = await prisma.school.findUnique({
      where:   { id: schoolId },
      include: {
        semesters: {
          orderBy: { startDate: "desc" },
        },
      },
    });

    if (!school) {
      res.status(404).json({
        success: false,
        message: "School not found",
      });
      return;
    }

    res.status(200).json({
      success: true,
      message: "School retrieved successfully",
      data:    school,
    });
  } catch (error) {
    console.error("[schoolControllers.getSchoolById]", {
      schoolId,
      error: error instanceof Error ? error.message : error,
    });
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
//  ADD SCHOOL — ADMIN
//  POST /api/schools
//
//  Admin registers a new school on AskDerek.
//  School name must be unique — case insensitive check.
//  Used to link hostel bookings to school academic calendars.
// ─────────────────────────────────────────────────────────────────────────────
export const addSchool = async (
  req: Request,
  res: Response<ApiResponse>
): Promise<void> => {
  const adminClerkId = await requireAdminAuth(req, res);
  if (!adminClerkId) return;

  const parsed = addSchoolSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      success: false,
      message: "Validation failed",
      errors:  formatZodErrors(parsed.error.issues),
    });
    return;
  }

  const { name, location, adminDbId } = parsed.data;

  try {
    // Case insensitive uniqueness check — "UMAT" and "umat" are the same school
    const existing = await prisma.school.findFirst({
      where: { name: { equals: name, mode: "insensitive" } },
    });

    if (existing) {
      res.status(400).json({
        success: false,
        message: `School "${name}" already exists`,
      });
      return;
    }

    const school = await prisma.school.create({
      data: { name, location },
    });

    await logAdminEvent({
      adminId: adminDbId,
      action:  "SCHOOL_ADDED",
      target:  `School #${school.id}`,
      details: `Added school: ${name} in ${location} by ${adminClerkId}`,
    });

    res.status(201).json({
      success: true,
      message: "School added successfully",
      data:    school,
    });
  } catch (error) {
    console.error("[schoolControllers.addSchool]", {
      name,
      adminClerkId,
      error: error instanceof Error ? error.message : error,
    });
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
//  ADD SEMESTER — ADMIN
//  POST /api/schools/:schoolId/semesters
//
//  Admin adds a new semester to a school.
//  endDate starts as null — updated when school officially announces it.
//  isConfirmed starts as false — set to true when endDate is confirmed.
//  Semester name must be unique per school — prevents duplicates.
// ─────────────────────────────────────────────────────────────────────────────
export const addSemester = async (
  req: Request,
  res: Response<ApiResponse>
): Promise<void> => {
  const adminClerkId = await requireAdminAuth(req, res);
  if (!adminClerkId) return;

  const schoolId = getNumericParam(req.params.schoolId, "schoolId", res);
  if (!schoolId) return;

  const parsed = addSemesterSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      success: false,
      message: "Validation failed",
      errors:  formatZodErrors(parsed.error.issues),
    });
    return;
  }

  const { semesterName, startDate, adminDbId } = parsed.data;

  try {
    const school = await prisma.school.findUnique({
      where: { id: schoolId },
    });

    if (!school) {
      res.status(404).json({
        success: false,
        message: "School not found",
      });
      return;
    }

    // Prevent duplicate semester name for the same school
    const existing = await prisma.schoolSemester.findFirst({
      where: {
        schoolId,
        semesterName: { equals: semesterName, mode: "insensitive" },
      },
    });

    if (existing) {
      res.status(400).json({
        success: false,
        message: `Semester "${semesterName}" already exists for ${school.name}`,
      });
      return;
    }

    const semester = await prisma.schoolSemester.create({
      data: {
        schoolId,
        semesterName,
        startDate:   new Date(startDate),
        endDate:     null,
        isConfirmed: false,
      },
    });

    await logAdminEvent({
      adminId: adminDbId,
      action:  "SEMESTER_ADDED",
      target:  `SchoolSemester #${semester.id}`,
      details: `Added ${semesterName} for ${school.name}. Start: ${startDate}`,
    });

    res.status(201).json({
      success: true,
      message: "Semester added successfully",
      data:    semester,
    });
  } catch (error) {
    console.error("[schoolControllers.addSemester]", {
      schoolId,
      adminClerkId,
      error: error instanceof Error ? error.message : error,
    });
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
//  UPDATE SEMESTER END DATE — ADMIN
//  PUT /api/schools/:schoolId/semesters/:semesterId
//
//  Admin confirms the semester closing date after school announces it.
//  This is the critical action for SCHOOL_CALENDAR hostel bookings.
//  Sets isConfirmed to true and records the confirmation timestamp.
//  After this call notifyAllStudents can be triggered.
// ─────────────────────────────────────────────────────────────────────────────
export const updateSemesterEndDate = async (
  req: Request,
  res: Response<ApiResponse>
): Promise<void> => {
  const adminClerkId = await requireAdminAuth(req, res);
  if (!adminClerkId) return;

  const schoolId   = getNumericParam(req.params.schoolId,   "schoolId",   res);
  if (!schoolId) return;

  const semesterId = getNumericParam(req.params.semesterId, "semesterId", res);
  if (!semesterId) return;

  const parsed = updateSemesterEndDateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      success: false,
      message: "Validation failed",
      errors:  formatZodErrors(parsed.error.issues),
    });
    return;
  }

  const { endDate, adminDbId } = parsed.data;

  try {
    const semester = await prisma.schoolSemester.findFirst({
      where: { id: semesterId, schoolId },
      include: {
        school: { select: { name: true } },
      },
    });

    if (!semester) {
      res.status(404).json({
        success: false,
        message: "Semester not found",
      });
      return;
    }

    // End date must be strictly after start date
    if (new Date(endDate) <= new Date(semester.startDate)) {
      res.status(400).json({
        success: false,
        message: "End date must be after the semester start date",
      });
      return;
    }

    const updated = await prisma.schoolSemester.update({
      where: { id: semesterId },
      data: {
        endDate:     new Date(endDate),
        isConfirmed: true,
        confirmedAt: new Date(),
      },
    });

    await logAdminEvent({
      adminId: adminDbId,
      action:  "SEMESTER_END_DATE_UPDATED",
      target:  `SchoolSemester #${semesterId}`,
      details: `${semester.semesterName} for ${semester.school.name} confirmed. End: ${endDate}. By: ${adminClerkId}`,
    });

    res.status(200).json({
      success: true,
      message: "Semester end date confirmed successfully",
      data:    updated,
    });
  } catch (error) {
    console.error("[schoolControllers.updateSemesterEndDate]", {
      schoolId,
      semesterId,
      adminClerkId,
      error: error instanceof Error ? error.message : error,
    });
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
//  NOTIFY ALL STUDENTS — ADMIN
//  POST /api/schools/:schoolId/semesters/:semesterId/notify
//
//  Admin triggers bulk notification to all students linked to this semester.
//  Semester end date must be confirmed before this can be called.
//  Finds all active SCHOOL_CALENDAR hostel bookings for this school.
//  Logs the notification event with full details for Derek's audit trail.
//
//  TODO Phase 4:
//  Wire actual SMS dispatch via notificationService.ts using Arkesel API.
//  Each studentClerkId maps to a phone number in the User table.
//  Send the smsMessage to each student's registered phone number.
// ─────────────────────────────────────────────────────────────────────────────
export const notifyAllStudents = async (
  req: Request,
  res: Response<ApiResponse>
): Promise<void> => {
  const adminClerkId = await requireAdminAuth(req, res);
  if (!adminClerkId) return;

  const schoolId   = getNumericParam(req.params.schoolId,   "schoolId",   res);
  if (!schoolId) return;

  const semesterId = getNumericParam(req.params.semesterId, "semesterId", res);
  if (!semesterId) return;

  const parsed = notifyStudentsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      success: false,
      message: "Validation failed",
      errors:  formatZodErrors(parsed.error.issues),
    });
    return;
  }

  const { adminDbId, message } = parsed.data;

  try {
    const semester = await prisma.schoolSemester.findFirst({
      where: { id: semesterId, schoolId },
      include: {
        school: { select: { name: true } },
      },
    });

    if (!semester) {
      res.status(404).json({
        success: false,
        message: "Semester not found",
      });
      return;
    }

    // Cannot notify until end date is confirmed
    if (!semester.isConfirmed || !semester.endDate) {
      res.status(400).json({
        success: false,
        message: "Cannot notify students — semester end date is not confirmed yet",
      });
      return;
    }

    // Find all active bookings linked to this school and semester
    const affectedBookings = await prisma.semesterPlan.findMany({
      where: {
        schoolId,
        semesterName: semester.semesterName,
        status:       { in: ["ACTIVE", "EXPIRING", "EXTENDED"] },
      },
      select: {
        id:             true,
        studentClerkId: true,
        roomNumber:     true,
      },
    });

    // Use reliable ISO date format — avoids server locale issues
    const formattedEnd = formatDate(semester.endDate);

    // Build default SMS if no custom message provided
    // Kept under 160 characters for standard SMS compliance
    const smsMessage = message ??
      `AskDerek: ${semester.school.name} ${semester.semesterName} ends ${formattedEnd}. Please prepare for checkout.`;

    await logAdminEvent({
      adminId: adminDbId,
      action:  "STUDENTS_NOTIFIED",
      target:  `SchoolSemester #${semesterId}`,
      details: `Notified ${affectedBookings.length} students. School: ${semester.school.name}. Semester: ${semester.semesterName}. End: ${formattedEnd}`,
    });

    res.status(200).json({
      success: true,
      message: `Notification queued for ${affectedBookings.length} students`,
      data: {
        studentsNotified: affectedBookings.length,
        semesterName:     semester.semesterName,
        schoolName:       semester.school.name,
        endDate:          semester.endDate,
        formattedEndDate: formattedEnd,
        smsMessage,
      },
    });
  } catch (error) {
    console.error("[schoolControllers.notifyAllStudents]", {
      schoolId,
      semesterId,
      adminClerkId,
      error: error instanceof Error ? error.message : error,
    });
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
//  GET SEMESTER STATUS — ADMIN
//  GET /api/schools/:schoolId/semesters/:semesterId/status
//
//  Returns full status of a semester including active student count.
//  Used by Derek to monitor which schools need closing date updates.
//  requiresAction = true when end date has not been confirmed yet.
// ─────────────────────────────────────────────────────────────────────────────
export const getSemesterStatus = async (
  req: Request,
  res: Response<ApiResponse>
): Promise<void> => {
  const adminClerkId = await requireAdminAuth(req, res);
  if (!adminClerkId) return;

  const schoolId   = getNumericParam(req.params.schoolId,   "schoolId",   res);
  if (!schoolId) return;

  const semesterId = getNumericParam(req.params.semesterId, "semesterId", res);
  if (!semesterId) return;

  try {
    const semester = await prisma.schoolSemester.findFirst({
      where: { id: semesterId, schoolId },
      include: {
        school: { select: { id: true, name: true, location: true } },
      },
    });

    if (!semester) {
      res.status(404).json({
        success: false,
        message: "Semester not found",
      });
      return;
    }

    // Both counts run in parallel — single round trip to database
    const [activeCount, totalCount] = await Promise.all([
      prisma.semesterPlan.count({
        where: {
          schoolId,
          semesterName: semester.semesterName,
          status:       { in: ["ACTIVE", "EXPIRING", "EXTENDED"] },
        },
      }),
      prisma.semesterPlan.count({
        where: {
          schoolId,
          semesterName: semester.semesterName,
        },
      }),
    ]);

    res.status(200).json({
      success: true,
      message: "Semester status retrieved",
      data: {
        semester,
        affectedStudents: {
          active: activeCount,
          total:  totalCount,
        },
        requiresAction: !semester.isConfirmed,
      },
    });
  } catch (error) {
    console.error("[schoolControllers.getSemesterStatus]", {
      schoolId,
      semesterId,
      adminClerkId,
      error: error instanceof Error ? error.message : error,
    });
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
//  REMOVE SCHOOL — ADMIN
//  DELETE /api/schools/:schoolId
//
//  Admin removes a school from AskDerek.
//  Blocked if any active student bookings are linked to this school.
//  Completed and expired bookings do not block deletion.
// ─────────────────────────────────────────────────────────────────────────────
export const removeSchool = async (
  req: Request,
  res: Response<ApiResponse>
): Promise<void> => {
  const adminClerkId = await requireAdminAuth(req, res);
  if (!adminClerkId) return;

  const schoolId = getNumericParam(req.params.schoolId, "schoolId", res);
  if (!schoolId) return;

  // Use the shared adminActionSchema — consistent with all other admin actions
  const parsed = adminActionSchema.safeParse(req.body);
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
    const school = await prisma.school.findUnique({
      where: { id: schoolId },
    });

    if (!school) {
      res.status(404).json({
        success: false,
        message: "School not found",
      });
      return;
    }

    // Block removal if any student is currently active in this school
    const activeBookings = await prisma.semesterPlan.count({
      where: {
        schoolId,
        status: { in: ["ACTIVE", "EXPIRING", "EXTENDED"] },
      },
    });

    if (activeBookings > 0) {
      res.status(400).json({
        success: false,
        message: `Cannot remove school — ${activeBookings} active student booking(s) linked to it`,
      });
      return;
    }

    await prisma.school.delete({ where: { id: schoolId } });

    await logAdminEvent({
      adminId: adminDbId,
      action:  "SCHOOL_REMOVED",
      target:  `School #${schoolId}`,
      details: `Removed school: ${school.name} in ${school.location} by ${adminClerkId}`,
    });

    res.status(200).json({
      success: true,
      message: "School removed successfully",
    });
  } catch (error) {
    console.error("[schoolControllers.removeSchool]", {
      schoolId,
      adminClerkId,
      error: error instanceof Error ? error.message : error,
    });
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};