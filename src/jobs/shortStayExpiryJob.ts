// ─────────────────────────────────────────────────────────────────────────────
//  shortStayExpiryJob.ts
//
//  Runs every 10 minutes.
//
//  Action 1 — Mark no-shows
//    CONFIRMED bookings where checkIn passed 3 hours ago.
//    Guest did not arrive — marked as NO_SHOW.
//
//  Action 2 — Auto complete bookings
//    CHECKED_IN bookings where checkOut has passed.
//    Auto marked as CHECKED_OUT.
//    Property set back to AVAILABLE atomically.
// ─────────────────────────────────────────────────────────────────────────────

import cron                  from "node-cron";
import { prisma }            from "../lib/prisma";
import { logSystemEvent }    from "../lib/auditService";
import { BookingStatus }     from "@prisma/client";

const markNoShows = async (): Promise<void> => {
  const now           = new Date();
  const threeHoursAgo = new Date(now.getTime() - 3 * 60 * 60 * 1000);

  try {
    const noShowBookings = await prisma.booking.findMany({
      where: {
        status:  BookingStatus.CONFIRMED,
        checkIn: { lt: threeHoursAgo },
      },
      select: {
        id:           true,
        propertyId:   true,
        guestClerkId: true,
        checkIn:      true,
      },
    });

    if (noShowBookings.length === 0) return;

    for (const booking of noShowBookings) {
      try {
        await prisma.booking.update({
          where: { id: booking.id },
          data:  { status: BookingStatus.NO_SHOW },
        });

        await logSystemEvent({
          action:  "BOOKING_AUTO_NO_SHOW",
          target:  `Booking #${booking.id}`,
          details: `Auto no-show by cron. Guest: ${booking.guestClerkId}. CheckIn was: ${booking.checkIn.toISOString()}`,
        });
      } catch (err) {
        console.error(`[shortStayExpiryJob] Failed to mark Booking #${booking.id} as no-show`, {
          error: err instanceof Error ? err.message : err,
        });
      }
    }

    console.log(`[shortStayExpiryJob] Marked ${noShowBookings.length} no-show(s)`);
  } catch (error) {
    console.error("[shortStayExpiryJob.markNoShows] Fatal error", {
      error: error instanceof Error ? error.message : error,
    });
  }
};

const autoCompleteBookings = async (): Promise<void> => {
  const now = new Date();

  try {
    const overdueCheckouts = await prisma.booking.findMany({
      where: {
        status:   BookingStatus.CHECKED_IN,
        checkOut: { lt: now },
      },
      select: {
        id:         true,
        propertyId: true,
        checkOut:   true,
      },
    });

    if (overdueCheckouts.length === 0) return;

    for (const booking of overdueCheckouts) {
      try {
        // Atomic — checkout booking and free property together
        await prisma.$transaction([
          prisma.booking.update({
            where: { id: booking.id },
            data:  { status: BookingStatus.CHECKED_OUT },
          }),
          prisma.property.updateMany({
            where: {
              id:            booking.propertyId,
              listingStatus: "AVAILABLE",
            },
            data: { listingStatus: "AVAILABLE" },
          }),
        ]);

        await logSystemEvent({
          action:  "BOOKING_AUTO_CHECKOUT",
          target:  `Booking #${booking.id}`,
          details: `Auto checked out by cron. CheckOut was: ${booking.checkOut.toISOString()}. Property #${booking.propertyId}`,
        });
      } catch (err) {
        console.error(`[shortStayExpiryJob] Failed to auto checkout Booking #${booking.id}`, {
          error: err instanceof Error ? err.message : err,
        });
      }
    }

    console.log(`[shortStayExpiryJob] Auto completed ${overdueCheckouts.length} booking(s)`);
  } catch (error) {
    console.error("[shortStayExpiryJob.autoCompleteBookings] Fatal error", {
      error: error instanceof Error ? error.message : error,
    });
  }
};

export const startShortStayExpiryJob = (): void => {
  cron.schedule("*/10 * * * *", async () => {
    await markNoShows();
    await autoCompleteBookings();
  }, {
    timezone: "Africa/Accra",
  });

  console.log("✅ Short stay expiry job scheduled — runs every 10 minutes");
};