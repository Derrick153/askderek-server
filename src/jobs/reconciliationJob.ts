import cron           from "node-cron";
import { prisma }     from "../lib/prisma";
import { paystackVerify } from "../lib/paystack";
import { logSystemEvent } from "../lib/auditService";

// ─────────────────────────────────────────────────────────────────────────────
//  reconciliationJob.ts
//
//  Runs every day at 2am Ghana time.
//  Compares your database against Paystack.
//  Finds payments that Paystack confirmed but your DB missed.
//  Fixes them automatically where safe.
//
//  Real life example:
//  Kofi paid at 11:59pm. Your server was restarting.
//  Webhook never arrived. DB shows Pending. Paystack shows Success.
//  This job finds that mismatch at 2am and fixes it.
// ─────────────────────────────────────────────────────────────────────────────

export const startReconciliationJob = (): void => {
  cron.schedule("0 2 * * *", async () => {
    console.log("🔄 [RECONCILIATION JOB] Running 2am reconciliation...");

    let fixed   = 0;
    let flagged = 0;

    try {
      // ── Find all PENDING transactions from last 48 hours ──
      const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000);

      const pendingTransactions = await prisma.transaction.findMany({
        where: {
          status:            "Pending",
          createdAt:         { gte: cutoff },
          paystackReference: { not: null },
        },
        include: {
          payment: true,
          lease: {
            include: {
              property: true,
              tenant:   { include: { user: true } },
            },
          },
        },
      });

      console.log(
        `[RECONCILIATION JOB] Checking ${pendingTransactions.length} pending transactions`
      );

      for (const transaction of pendingTransactions) {
        if (!transaction.paystackReference) continue;

        try {
          // ── Verify against Paystack ──
          const paystackData = await paystackVerify(
            transaction.paystackReference
          );

          if (paystackData.status === "success") {
            // ── Paystack says paid — DB says pending — fix it ──
            const amountGHS = paystackData.amount / 100;

            // ── Update transaction ──
            await prisma.transaction.update({
              where: { id: transaction.id },
              data:  {
                status:  "Success",
                channel: paystackData.channel,
                paidAt:  new Date(paystackData.paidAt),
              },
            });

            // ── Create or update payment ──
            if (transaction.payment) {
              await prisma.payment.update({
                where: { id: transaction.payment.id },
                data:  {
                  paymentStatus: "Paid",
                  amountPaid:    amountGHS,
                  paymentDate:   new Date(paystackData.paidAt),
                },
              });
            } else {
              await prisma.payment.create({
                data: {
                  leaseId:           transaction.leaseId!,
                  amountDue:         amountGHS,
                  amountPaid:        amountGHS,
                  dueDate:           new Date(),
                  paymentDate:       new Date(paystackData.paidAt),
                  paymentStatus:     "Paid",
                  paystackReference: transaction.paystackReference,
                },
              });
            }

            await logSystemEvent({
              action:  "PAYMENT_SUCCESS",
              target:  `Reconciliation — ref: ${transaction.paystackReference}`,
              details: `Auto-fixed by reconciliation job. Amount: GHS ${amountGHS}`,
            });

            console.log(
              `✅ [RECONCILIATION JOB] Fixed: ${transaction.paystackReference}`
            );
            fixed++;
          } else if (
            paystackData.status === "failed" ||
            paystackData.status === "abandoned"
          ) {
            // ── Paystack says failed — update DB ──
            await prisma.transaction.update({
              where: { id: transaction.id },
              data:  { status: "Failed" },
            });

            await logSystemEvent({
              action:  "PAYMENT_FAILED",
              target:  `Reconciliation — ref: ${transaction.paystackReference}`,
              details: `Paystack status: ${paystackData.status}`,
            });

            fixed++;
          } else {
            // ── Still pending on Paystack — flag for admin review ──
            await logSystemEvent({
              action:  "WEBHOOK_RECEIVED",
              target:  `Reconciliation — ref: ${transaction.paystackReference}`,
              details: `Still pending on Paystack — flagged for admin review`,
            });
            flagged++;
          }
        } catch (err) {
          console.error(
            `❌ [RECONCILIATION JOB] Error checking ${transaction.paystackReference}:`,
            err
          );
        }
      }

      await logSystemEvent({
        action:  "WEBHOOK_VERIFIED",
        target:  "Reconciliation Job",
        details: `Fixed: ${fixed} — Flagged: ${flagged}`,
      });

      console.log(
        `✅ [RECONCILIATION JOB] Complete — Fixed: ${fixed} — Flagged: ${flagged}`
      );
    } catch (err) {
      console.error("❌ [RECONCILIATION JOB] Fatal error:", err);
    }
  }, { timezone: "Africa/Accra" });

  console.log("✅ Reconciliation job scheduled — runs daily at 2am Ghana time");
};