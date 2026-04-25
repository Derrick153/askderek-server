// ─────────────────────────────────────────────────────────────────────────────
//  semesterExpiryJob.ts
//
//  Runs daily at midnight Ghana time (UTC+0).
//
//  Action 1 — Mark expired hostel bookings
//    FIXED type — uses fixedEndDate directly.
//    SCHOOL_CALENDAR type — looks up confirmed expired semesters
//    then finds matching bookings explicitly.
//
//  Action 2 — Send expiry alerts
//    FIXED bookings expiring within 14 days.
//    SMS dispatch wired in Phase 4.
// ─────────────────────────────────────────────────────────────────────────────

import cron                    from "node-cron";
import { prisma }              from "../lib/prisma";
import { logSystemEvent }      from "../lib/auditService";
import { HostelBookingStatus } from "@prisma/client";

const markExpiredHostelBookings = async (): Promise<void> => {
  const now = new Date();

  try {
    // FIXED type — fixedEndDate has passed
    const fixedExpired = await prisma.semesterPlan.findMany({
      where: {
        status:       { in: [HostelBookingStatus.ACTIVE, HostelBookingStatus.EXPIRING] },
        closingType:  "FIXED",
        fixedEndDate: { lt: now },
      },
      select: { id: true, propertyId: true, studentClerkId: true },
    });

    // SCHOOL_CALENDAR type — explicit two step lookup
    // Step 1 — find confirmed expired semesters
    const confirmedExpiredSemesters = await prisma.schoolSemester.findMany({
      where: {
        isConfirmed: true,
        endDate:     { lt: now },
      },
      select: { schoolId: true, semesterName: true },
    });

    // Step 2 — find bookings matching those semesters
    const calendarExpired = confirmedExpiredSemesters.length > 0
      ? await prisma.semesterPlan.findMany({
          where: {
            status:      { in: [HostelBookingStatus.ACTIVE, HostelBookingStatus.EXPIRING] },
            closingType: "SCHOOL_CALENDAR",
            OR: confirmedExpiredSemesters.map(s => ({
              schoolId:     s.schoolId,
              semesterName: s.semesterName,
            })),
          },
          select: { id: true, propertyId: true, studentClerkId: true },
        })
      : [];

    const allExpired = [...fixedExpired, ...calendarExpired];

    if (allExpired.length === 0) {
      console.log(`[semesterExpiryJob] No expired hostel bookings at ${now.toISOString()}`);
      return;
    }

    let successCount = 0;
    let failCount    = 0;

    for (const booking of allExpired) {
      try {
        await prisma.semesterPlan.update({
          where: { id: booking.id },
          data:  { status: HostelBookingStatus.EXPIRED },
        });

        await logSystemEvent({
          action:  "HOSTEL_BOOKING_AUTO_EXPIRED",
          target:  `SemesterPlan #${booking.id}`,
          details: `Auto expired by cron. Student: ${booking.studentClerkId}. Property #${booking.propertyId}`,
        });

        successCount++;
      } catch (err) {
        failCount++;
        console.error(`[semesterExpiryJob] Failed to expire SemesterPlan #${booking.id}`, {
          error: err instanceof Error ? err.message : err,
        });
      }
    }

    console.log(`[semesterExpiryJob] Expired ${successCount} hostel booking(s). Failed: ${failCount}`);
  } catch (error) {
    console.error("[semesterExpiryJob.markExpiredHostelBookings] Fatal error", {
      error: error instanceof Error ? error.message : error,
    });
  }
};

const sendHostelExpiryAlerts = async (): Promise<void> => {
  const now       = new Date();
  const alertDate = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);

  try {
    const expiringFixed = await prisma.semesterPlan.findMany({
      where: {
        status:       HostelBookingStatus.ACTIVE,
        closingType:  "FIXED",
        fixedEndDate: { gte: now, lte: alertDate },
      },
      select: {
        id:             true,
        studentClerkId: true,
        fixedEndDate:   true,
        propertyId:     true,
      },
    });

    for (const booking of expiringFixed) {
      const daysRemaining = booking.fixedEndDate
        ? Math.ceil(
            (new Date(booking.fixedEndDate).getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
          )
        : 0;

      await logSystemEvent({
        action:  "HOSTEL_EXPIRY_ALERT",
        target:  `SemesterPlan #${booking.id}`,
        details: `Expiring in ${daysRemaining} days. Student: ${booking.studentClerkId}. Property #${booking.propertyId}`,
      });

      // TODO Phase 4 — wire Arkesel SMS here
    }

    if (expiringFixed.length > 0) {
      console.log(`[semesterExpiryJob] Expiry alerts logged for ${expiringFixed.length} hostel booking(s)`);
    }
  } catch (error) {
    console.error("[semesterExpiryJob.sendHostelExpiryAlerts] Fatal error", {
      error: error instanceof Error ? error.message : error,
    });
  }
};

export const startSemesterExpiryJob = (): void => {
  cron.schedule("0 0 * * *", async () => {
    console.log(`[semesterExpiryJob] Running at ${new Date().toISOString()}`);
    await markExpiredHostelBookings();
    await sendHostelExpiryAlerts();
  }, {
    timezone: "Africa/Accra",
  });

  console.log("✅ Semester expiry job scheduled — runs daily at midnight Ghana time");
};