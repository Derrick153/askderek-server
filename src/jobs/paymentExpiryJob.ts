import cron             from "node-cron";
import { prisma }       from "../lib/prisma";
import { isPaymentExpired } from "../lib/paymentUtils";
import { logSystemEvent }   from "../lib/auditService";
import { notifyTenantPaymentExpired } from "../lib/notificationService";

// ─────────────────────────────────────────────────────────────────────────────
//  paymentExpiryJob.ts
//
//  Runs every 10 minutes.
//  Finds INIT or PENDING payments older than 30 minutes.
//  Marks them EXPIRED and frees the payment slot.
//  Notifies tenant to retry.
// ─────────────────────────────────────────────────────────────────────────────

export const startPaymentExpiryJob = (): void => {
  cron.schedule("*/10 * * * *", async () => {
    console.log("⏰ [EXPIRY JOB] Checking for expired payments...");

    try {
      const expiryMinutes = parseInt(
        process.env.PAYMENT_EXPIRY_MINUTES || "30"
      );

      const cutoffTime = new Date(
        Date.now() - expiryMinutes * 60 * 1000
      );

      // ── Find old PENDING transactions ──
      const expiredTransactions = await prisma.transaction.findMany({
        where: {
          status:    "Pending",
          createdAt: { lt: cutoffTime },
        },
        include: {
          lease: {
            include: {
              tenant:   { include: { user: true } },
              property: true,
            },
          },
          payment: true,
        },
      });

      console.log(
        `[EXPIRY JOB] Found ${expiredTransactions.length} expired transactions`
      );

      for (const transaction of expiredTransactions) {
        try {
          // ── Mark transaction expired ──
          await prisma.transaction.update({
            where: { id: transaction.id },
            data:  { status: "Failed" },
          });

          // ── Mark payment expired if exists ──
          if (transaction.payment) {
            await prisma.payment.update({
              where: { id: transaction.payment.id },
              data:  { paymentStatus: "Pending" },
            });

            await prisma.paymentLog.create({
              data: {
                paymentId:      transaction.payment.id,
                action:         "PAYMENT_EXPIRED",
                previousStatus: "Pending",
                newStatus:      "Expired",
                performedBy:    "system",
                notes:          `Payment session expired after ${expiryMinutes} minutes`,
              },
            });
          }

          // ── Notify tenant ──
          const tenant   = transaction.lease?.tenant?.user;
          const property = transaction.lease?.property;

          if (tenant && property) {
            await notifyTenantPaymentExpired({
              tenantName:      tenant.name,
              tenantPhone:     tenant.phoneNumber || undefined,
              propertyAddress: property.name,
              amountDue:       transaction.amount,
            });
          }

          await logSystemEvent({
            action:  "PAYMENT_EXPIRED",
            target:  `Transaction ${transaction.id}`,
            details: `Expired after ${expiryMinutes} minutes`,
          });

          console.log(`✅ [EXPIRY JOB] Expired transaction ${transaction.id}`);
        } catch (err) {
          console.error(
            `❌ [EXPIRY JOB] Failed for transaction ${transaction.id}:`,
            err
          );
        }
      }

      console.log("✅ [EXPIRY JOB] Complete");
    } catch (err) {
      console.error("❌ [EXPIRY JOB] Fatal error:", err);
    }
  });

  console.log("✅ Payment expiry job scheduled — runs every 10 minutes");
};