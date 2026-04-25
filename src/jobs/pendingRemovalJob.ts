// ─────────────────────────────────────────────────────────────────────────────
//  pendingRemovalJob.ts
//
//  Runs every 10 minutes.
//
//  Executes soft delete on PENDING_REMOVAL properties
//  whose 10 minute undo window has expired.
//
//  Flow:
//    1. Admin triggers pending removal
//    2. removalExecuteAt = now + 10 minutes
//    3. Admin has 10 minutes to cancel
//    4. This job executes soft delete after window expires
//    5. Active leases frozen to preserve legal state
//    6. Property marked with deletedAt timestamp
// ─────────────────────────────────────────────────────────────────────────────

import cron               from "node-cron";
import { prisma }         from "../lib/prisma";
import { logSystemEvent } from "../lib/auditService";
import { ListingStatus }  from "@prisma/client";

const executePendingRemovals = async (): Promise<void> => {
  const now = new Date();

  try {
    const pendingProperties = await prisma.property.findMany({
      where: {
        listingStatus:    ListingStatus.PENDING_REMOVAL,
        removalExecuteAt: { lte: now },
        deletedAt:        null,
      },
      select: {
        id:               true,
        deleteType:       true,
        deleteReason:     true,
        pendingRemovalBy: true,
      },
    });

    if (pendingProperties.length === 0) return;

    let successCount = 0;
    let failCount    = 0;

    for (const property of pendingProperties) {
      try {
        // Atomic — soft delete property and freeze active leases together
        await prisma.$transaction([
          prisma.property.update({
            where: { id: property.id },
            data: {
              deletedAt:              now,
              deletedBy:              property.pendingRemovalBy,
              listingStatus:          ListingStatus.ARCHIVED,
              pendingRemovalAt:       null,
              pendingRemovalBy:       null,
              removalExecuteAt:       null,
              requiresAdminAttention: false,
            },
          }),
          // Freeze all active leases — preserves legal state
          prisma.lease.updateMany({
            where: { propertyId: property.id, status: "ACTIVE" },
            data: {
              isFrozen:     true,
              frozenAt:     now,
              freezeReason: "PROPERTY_REMOVED",
              status:       "FROZEN",
            },
          }),
        ]);

        await logSystemEvent({
          action:  "PROPERTY_SOFT_DELETED",
          target:  `Property #${property.id}`,
          details: `Soft deleted by cron. Type: ${property.deleteType}. Reason: ${property.deleteReason}`,
        });

        successCount++;
      } catch (err) {
        failCount++;
        console.error(`[pendingRemovalJob] Failed to soft delete Property #${property.id}`, {
          error: err instanceof Error ? err.message : err,
        });
      }
    }

    console.log(`[pendingRemovalJob] Soft deleted ${successCount} property(ies). Failed: ${failCount}`);
  } catch (error) {
    console.error("[pendingRemovalJob.executePendingRemovals] Fatal error", {
      error: error instanceof Error ? error.message : error,
    });
  }
};

export const startPendingRemovalJob = (): void => {
  cron.schedule("*/10 * * * *", async () => {
    await executePendingRemovals();
  }, {
    timezone: "Africa/Accra",
  });

  console.log("✅ Pending removal job scheduled — runs every 10 minutes");
};