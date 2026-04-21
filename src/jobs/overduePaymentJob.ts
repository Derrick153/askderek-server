import cron   from "node-cron";
import { prisma } from "../lib/prisma";
import { sendLandlordOverdueAlert } from "../lib/reminderService";
import { logSystemEvent }           from "../lib/auditService";

// ─────────────────────────────────────────────────────────────────────────────
//  overduePaymentJob.ts
//
//  Runs every day at midnight.
//  Finds all unpaid payments past their due date.
//  Marks them OVERDUE and alerts the landlord.
// ─────────────────────────────────────────────────────────────────────────────

export const startOverduePaymentJob = (): void => {
  cron.schedule("0 0 * * *", async () => {
    console.log("🕛 [OVERDUE JOB] Running midnight overdue check...");

    try {
      const now = new Date();

      // ── Find all unpaid payments past due date ──
      const overduePayments = await prisma.payment.findMany({
        where: {
          paymentStatus: "Pending",
          dueDate:       { lt: now },
        },
        include: {
          lease: {
            include: {
              tenant:   { include: { user: true } },
              property: {
                include: {
                  manager: { include: { user: true } },
                  location: true,
                },
              },
            },
          },
        },
      });

      console.log(`[OVERDUE JOB] Found ${overduePayments.length} overdue payments`);

      for (const payment of overduePayments) {
        try {
          // ── Mark as overdue ──
          await prisma.payment.update({
            where: { id: payment.id },
            data:  { paymentStatus: "Overdue" },
          });

          // ── Log action ──
          await prisma.paymentLog.create({
            data: {
              paymentId:   payment.id,
              action:      "OVERDUE_MARKED",
              previousStatus: "Pending",
              newStatus:   "Overdue",
              performedBy: "system",
              notes:       `Auto-marked overdue. Due: ${payment.dueDate.toISOString()}`,
            },
          });

          // ── Calculate days overdue ──
          const daysOverdue = Math.floor(
            (now.getTime() - payment.dueDate.getTime()) / 86_400_000
          );

          // ── Alert landlord ──
          const landlord  = payment.lease.property.manager.user;
          const tenant    = payment.lease.tenant.user;
          const property  = payment.lease.property;

          if (landlord.phoneNumber) {
            await sendLandlordOverdueAlert(
              landlord.phoneNumber,
              landlord.name,
              tenant.name,
              `${property.name}, ${property.location.city}`,
              payment.amountDue,
              daysOverdue
            );
          }

          await logSystemEvent({
            action:  "OVERDUE_MARKED",
            target:  `Payment #${payment.id}`,
            details: `${daysOverdue} days overdue. Tenant: ${tenant.name}`,
          });

          console.log(`✅ [OVERDUE JOB] Marked payment #${payment.id} as overdue`);
        } catch (err) {
          console.error(`❌ [OVERDUE JOB] Failed for payment #${payment.id}:`, err);
        }
      }

      console.log("✅ [OVERDUE JOB] Complete");
    } catch (err) {
      console.error("❌ [OVERDUE JOB] Fatal error:", err);
    }
  }, { timezone: "Africa/Accra" });

  console.log("✅ Overdue payment job scheduled — runs daily at midnight Ghana time");
};