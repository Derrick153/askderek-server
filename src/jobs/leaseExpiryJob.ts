// ─────────────────────────────────────────────────────────────────────────────
//  leaseExpiryJob.ts
//
//  Runs daily at midnight Ghana time (UTC+0).
//
//  Action 1 — Mark expired leases
//    Finds all ACTIVE leases where endDate has passed.
//    Marks them as EXPIRED.
//    Sets property back to AVAILABLE only if currently RENTED.
//
//  Action 2 — Send renewal alerts
//    Finds all ACTIVE leases expiring within 60 days.
//    Logs renewal alert for each.
//    SMS dispatch wired in Phase 4 via notificationService.
// ─────────────────────────────────────────────────────────────────────────────

import cron               from "node-cron";
import { prisma }         from "../lib/prisma";
import { logSystemEvent } from "../lib/auditService";

const markExpiredLeases = async (): Promise<void> => {
  const now = new Date();

  try {
    const expiredLeases = await prisma.lease.findMany({
      where: {
        status:  "ACTIVE",
        endDate: { lt: now },
      },
      select: {
        id:            true,
        propertyId:    true,
        tenantClerkId: true,
        endDate:       true,
      },
    });

    if (expiredLeases.length === 0) {
      console.log(`[leaseExpiryJob] No expired leases at ${now.toISOString()}`);
      return;
    }

    let successCount = 0;
    let failCount    = 0;

    for (const lease of expiredLeases) {
      try {
        await prisma.$transaction([
          prisma.lease.update({
            where: { id: lease.id },
            data: {
              status:   "EXPIRED",
              isFrozen: false,
            },
          }),
          // Only update property if it is currently RENTED
          // Prevents overwriting SOLD or ARCHIVED status
          prisma.property.updateMany({
            where: {
              id:            lease.propertyId,
              listingStatus: "RENTED",
            },
            data: { listingStatus: "AVAILABLE" },
          }),
        ]);

        await logSystemEvent({
          action:  "LEASE_AUTO_EXPIRED",
          target:  `Lease #${lease.id}`,
          details: `Auto expired by cron. Property #${lease.propertyId}. End date was: ${lease.endDate.toISOString()}`,
        });

        successCount++;
      } catch (err) {
        failCount++;
        console.error(`[leaseExpiryJob] Failed to expire Lease #${lease.id}`, {
          error: err instanceof Error ? err.message : err,
        });
      }
    }

    console.log(`[leaseExpiryJob] Expired ${successCount} lease(s). Failed: ${failCount}`);
  } catch (error) {
    console.error("[leaseExpiryJob.markExpiredLeases] Fatal error", {
      error: error instanceof Error ? error.message : error,
    });
  }
};

const sendRenewalAlerts = async (): Promise<void> => {
  const now       = new Date();
  const alertDate = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000);

  try {
    const expiringLeases = await prisma.lease.findMany({
      where: {
        status:  "ACTIVE",
        endDate: { gte: now, lte: alertDate },
      },
      select: {
        id:            true,
        tenantClerkId: true,
        endDate:       true,
        propertyId:    true,
      },
    });

    if (expiringLeases.length === 0) return;

    for (const lease of expiringLeases) {
      const daysRemaining = Math.ceil(
        (new Date(lease.endDate).getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
      );

      await logSystemEvent({
        action:  "LEASE_RENEWAL_ALERT",
        target:  `Lease #${lease.id}`,
        details: `Renewal alert. Expires in ${daysRemaining} days. Tenant: ${lease.tenantClerkId}. Property #${lease.propertyId}`,
      });

      // TODO Phase 4 — wire Arkesel SMS here
    }

    console.log(`[leaseExpiryJob] Renewal alerts logged for ${expiringLeases.length} lease(s)`);
  } catch (error) {
    console.error("[leaseExpiryJob.sendRenewalAlerts] Fatal error", {
      error: error instanceof Error ? error.message : error,
    });
  }
};

export const startLeaseExpiryJob = (): void => {
  cron.schedule("0 0 * * *", async () => {
    console.log(`[leaseExpiryJob] Running at ${new Date().toISOString()}`);
    await markExpiredLeases();
    await sendRenewalAlerts();
  }, {
    timezone: "Africa/Accra",
  });

  console.log("✅ Lease expiry job scheduled — runs daily at midnight Ghana time");
};