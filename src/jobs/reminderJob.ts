import cron         from "node-cron";
import { prisma }   from "../lib/prisma";
import { daysUntilDue } from "../lib/paymentUtils";
import {
  sendSevenDayReminder,
  sendThreeDayReminder,
  sendDueTodayReminder,
  sendOneDayOverdueWarning,
  sendFinalOverdueWarning,
} from "../lib/reminderService";
import { logSystemEvent } from "../lib/auditService";

// ─────────────────────────────────────────────────────────────────────────────
//  reminderJob.ts
//
//  Runs every day at 8am Ghana time.
//  Sends SMS reminders to tenants based on how close their due date is.
//
//  Reminder schedule:
//  - 7 days before due → early reminder
//  - 3 days before due → urgent reminder
//  - 0 days (due today) → final reminder
//  - 1 day overdue → warning
//  - 3 days overdue → final warning
// ─────────────────────────────────────────────────────────────────────────────

export const startReminderJob = (): void => {
  cron.schedule("0 8 * * *", async () => {
    console.log("📱 [REMINDER JOB] Running daily reminder check at 8am...");

    try {
      // ── Get all active leases with pending payments ──
      const leases = await prisma.lease.findMany({
        where: {
          endDate: { gt: new Date() },
        },
        include: {
          tenant:   { include: { user: true } },
          property: { include: { location: true } },
          payments: {
            where: {
              paymentStatus: { in: ["Pending", "Overdue"] },
            },
            orderBy: { dueDate: "asc" },
            take: 1,
          },
        },
      });

      console.log(`[REMINDER JOB] Checking ${leases.length} active leases`);

      let sent = 0;

      for (const lease of leases) {
        // ── Skip if no pending payment ──
        if (lease.payments.length === 0) continue;

        const payment  = lease.payments[0];
        const tenant   = lease.tenant.user;
        const property = lease.property;

        if (!tenant.phoneNumber) continue;

        const days = daysUntilDue(payment.dueDate);

        const payload = {
          tenantName:      tenant.name,
          tenantPhone:     tenant.phoneNumber,
          propertyAddress: `${property.name}, ${property.location.city}`,
          amountDue:       payment.amountDue,
          dueDate:         payment.dueDate,
          leaseId:         lease.id,
          daysUntilDue:    days,
        };

        try {
          if (days === 7) {
            await sendSevenDayReminder(payload);
            sent++;
          } else if (days === 3) {
            await sendThreeDayReminder(payload);
            sent++;
          } else if (days === 0) {
            await sendDueTodayReminder(payload);
            sent++;
          } else if (days === -1) {
            await sendOneDayOverdueWarning(payload);
            sent++;
          } else if (days === -3) {
            await sendFinalOverdueWarning(payload);
            sent++;
          }
        } catch (err) {
          console.error(
            `❌ [REMINDER JOB] Failed to send reminder to ${tenant.name}:`,
            err
          );
        }
      }

      await logSystemEvent({
        action:  "REMINDER_SENT",
        target:  "Reminder Job",
        details: `Sent ${sent} reminders to tenants`,
      });

      console.log(`✅ [REMINDER JOB] Complete — ${sent} reminders sent`);
    } catch (err) {
      console.error("❌ [REMINDER JOB] Fatal error:", err);
    }
  }, { timezone: "Africa/Accra" });

  console.log("✅ Reminder job scheduled — runs daily at 8am Ghana time");
};