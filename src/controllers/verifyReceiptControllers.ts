// ─────────────────────────────────────────────────────────────────────────────
//  verifyReceiptControllers.ts
//
//  Payment receipt verification for AskDerek.
//
//  The Ghana Problem This Solves:
//    Tenants send fake MoMo screenshots to landlords.
//    Landlords cannot verify if a payment is genuine.
//    AskDerek generates a unique verifiable reference
//    for every payment. Anyone with the reference can
//    confirm it is real directly from AskDerek.
//
//  Three verification methods:
//    1. By Paystack reference — from payment confirmation SMS
//    2. By booking reference — short stay (BK-YYYY-XXXXXXXX)
//    3. By hostel reference  — hostel booking (HST-YYYY-XXXXXXXX)
//
//  Business rules enforced:
//    — Public endpoint — no auth required for verification
//    — Only safe public fields returned — no sensitive data exposed
//    — References are case insensitive — avoids user typing errors
//    — Every verification attempt logged for fraud detection
//    — Failed verifications also logged
// ─────────────────────────────────────────────────────────────────────────────

import { Request, Response } from "express";
import { z }                 from "zod";
import { prisma }            from "../lib/prisma";
import { logSystemEvent }    from "../lib/auditService";

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

const verifyByReferenceSchema = z.object({
  reference: z.string()
              .min(3,   "Reference must be at least 3 characters")
              .max(100, "Reference cannot exceed 100 characters"),
});

// ── SHARED HELPERS ────────────────────────────────────────────────────────────

// Converts Zod issues to the standard API error shape.
const formatZodErrors = (
  issues: z.ZodIssue[]
): { field: string; message: string }[] =>
  issues.map(i => ({
    field:   String(i.path[0] ?? "unknown"),
    message: i.message,
  }));

// Core verification logic — shared by verifyByReference and verifyByBody.
// Checks payment records first then booking then hostel.
// Returns true if a response was sent — false if not found.
const runVerification = async (
  reference: string,
  res:       Response<ApiResponse>
): Promise<boolean> => {

  // ── Check 1: Paystack payment reference ──────────────────────────────────
  const payment = await prisma.payment.findFirst({
    where: {
      paystackReference: { equals: reference, mode: "insensitive" },
    },
    include: {
      lease: {
        include: {
          property: {
            include: { location: true },
          },
        },
      },
    },
  });

  if (payment) {
    await logSystemEvent({
      action:  "RECEIPT_VERIFIED",
      target:  `Payment reference: ${reference}`,
      details: `Payment verified. Status: ${payment.paymentStatus}. Amount: GHS ${payment.amountPaid}`,
    });

    res.status(200).json({
      success: true,
      message: "Payment verified successfully",
      data: {
        type: "RENT_PAYMENT",
        receipt: {
          reference:    payment.paystackReference,
          status:       payment.paymentStatus,
          amountPaid:   payment.amountPaid,
          paymentDate:  payment.paymentDate,
          propertyName: payment.lease?.property?.name ?? null,
          location:     payment.lease?.property?.location ?? null,
          verifiedAt:   new Date().toISOString(),
          verifiedBy:   "AskDerek Payment System",
        },
      },
    });
    return true;
  }

  // ── Check 2: Short stay booking reference ─────────────────────────────────
  const booking = await prisma.booking.findFirst({
    where: {
      reference: { equals: reference, mode: "insensitive" },
    },
    include: {
      property: {
        select: {
          name:     true,
          location: {
            select: { city: true, region: true },
          },
        },
      },
    },
  });

  if (booking) {
    await logSystemEvent({
      action:  "RECEIPT_VERIFIED",
      target:  `Booking reference: ${reference}`,
      details: `Short stay booking verified. Status: ${booking.status}. Amount: GHS ${booking.totalAmount}`,
    });

    res.status(200).json({
      success: true,
      message: "Booking verified successfully",
      data: {
        type: "SHORT_STAY_BOOKING",
        receipt: {
          reference:    booking.reference,
          status:       booking.status,
          amountPaid:   booking.totalAmount,
          checkIn:      booking.checkIn,
          checkOut:     booking.checkOut,
          propertyName: booking.property.name,
          location:     booking.property.location,
          verifiedAt:   new Date().toISOString(),
          verifiedBy:   "AskDerek Payment System",
        },
      },
    });
    return true;
  }

  // ── Check 3: Hostel booking reference ─────────────────────────────────────
  const hostelBooking = await prisma.semesterPlan.findFirst({
    where: {
      reference: { equals: reference, mode: "insensitive" },
    },
    include: {
      school: {
        select: { name: true, location: true },
      },
    },
  });

  if (hostelBooking) {
    await logSystemEvent({
      action:  "RECEIPT_VERIFIED",
      target:  `Hostel reference: ${reference}`,
      details: `Hostel booking verified. Status: ${hostelBooking.status}. Amount: GHS ${hostelBooking.amountPaid}`,
    });

    res.status(200).json({
      success: true,
      message: "Hostel booking verified successfully",
      data: {
        type: "HOSTEL_BOOKING",
        receipt: {
          reference:    hostelBooking.reference,
          status:       hostelBooking.status,
          amountPaid:   hostelBooking.amountPaid,
          semesterName: hostelBooking.semesterName,
          checkIn:      hostelBooking.checkIn,
          roomNumber:   hostelBooking.roomNumber,
          schoolName:   hostelBooking.school?.name ?? null,
          verifiedAt:   new Date().toISOString(),
          verifiedBy:   "AskDerek Payment System",
        },
      },
    });
    return true;
  }

  return false;
};

// ─────────────────────────────────────────────────────────────────────────────
//  VERIFY PAYMENT BY REFERENCE
//  GET /api/verify/:reference
//
//  Public endpoint — anyone with the reference can verify.
//  Used by landlords to confirm a tenant payment is genuine.
//  Checks payment then booking then hostel records in sequence.
//  Returns a safe public receipt — no sensitive data exposed.
// ─────────────────────────────────────────────────────────────────────────────
export const verifyByReference = async (
  req: Request,
  res: Response<ApiResponse>
): Promise<void> => {
  const parsed = verifyByReferenceSchema.safeParse({
    reference: req.params.reference,
  });

  if (!parsed.success) {
    res.status(400).json({
      success: false,
      message: "Invalid reference format",
      errors:  formatZodErrors(parsed.error.issues),
    });
    return;
  }

  const { reference } = parsed.data;

  try {
    const found = await runVerification(reference, res);

    if (!found) {
      await logSystemEvent({
        action:  "RECEIPT_VERIFY_FAILED",
        target:  `Reference: ${reference}`,
        details: "Reference not found in payment, booking or hostel records",
      });

      res.status(404).json({
        success: false,
        message: "No payment found for this reference. If you believe this is an error please contact AskDerek support.",
      });
    }
  } catch (error) {
    console.error("[verifyReceiptControllers.verifyByReference]", {
      reference,
      error: error instanceof Error ? error.message : error,
    });
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
//  VERIFY PAYMENT BY BODY
//  POST /api/verify
//
//  Same verification but reference passed in request body.
//  Used when QR code scanner sends a POST request.
//  Shares the same runVerification logic — no duplication.
// ─────────────────────────────────────────────────────────────────────────────
export const verifyByBody = async (
  req: Request,
  res: Response<ApiResponse>
): Promise<void> => {
  const parsed = verifyByReferenceSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({
      success: false,
      message: "Validation failed",
      errors:  formatZodErrors(parsed.error.issues),
    });
    return;
  }

  const { reference } = parsed.data;

  try {
    const found = await runVerification(reference, res);

    if (!found) {
      await logSystemEvent({
        action:  "RECEIPT_VERIFY_FAILED",
        target:  `Reference: ${reference}`,
        details: "Reference not found in payment, booking or hostel records",
      });

      res.status(404).json({
        success: false,
        message: "No payment found for this reference. If you believe this is an error please contact AskDerek support.",
      });
    }
  } catch (error) {
    console.error("[verifyReceiptControllers.verifyByBody]", {
      reference,
      error: error instanceof Error ? error.message : error,
    });
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
//  GET RECEIPT SUMMARY — TENANT
//  GET /api/verify/receipt/:reference
//
//  Returns a printable receipt for a specific payment.
//  Used by tenants who want to download or print their receipt.
//  More detailed than verifyByReference — includes receipt number.
// ─────────────────────────────────────────────────────────────────────────────
export const getReceiptSummary = async (
  req: Request,
  res: Response<ApiResponse>
): Promise<void> => {
  const parsed = verifyByReferenceSchema.safeParse({
    reference: req.params.reference,
  });

  if (!parsed.success) {
    res.status(400).json({
      success: false,
      message: "Invalid reference format",
      errors:  formatZodErrors(parsed.error.issues),
    });
    return;
  }

  const { reference } = parsed.data;

  try {
    const payment = await prisma.payment.findFirst({
      where: {
        paystackReference: { equals: reference, mode: "insensitive" },
      },
      include: {
        lease: {
          include: {
            property: {
              include: { location: true },
            },
          },
        },
      },
    });

    if (payment && payment.lease) {
      const lease    = payment.lease;
      const property = lease.property;

      res.status(200).json({
        success: true,
        message: "Receipt retrieved successfully",
        data: {
          receipt: {
            reference:     payment.paystackReference,
            receiptNumber: `RCP-${payment.id}`,
            status:        payment.paymentStatus,
            amountPaid:    payment.amountPaid,
            amountDue:     payment.amountDue,
            paymentDate:   payment.paymentDate,
            dueDate:       payment.dueDate,
            propertyName:  property.name,
            propertyType:  property.propertyType,
            location:      property.location,
            landlordName:  "AskDerek Verified Property",
            issuedBy:      "AskDerek Ghana",
            issuedAt:      new Date().toISOString(),
            note:          "This receipt is digitally verified by AskDerek. Reference this number for all payment disputes.",
          },
        },
      });
      return;
    }

    res.status(404).json({
      success: false,
      message: "Receipt not found for this reference",
    });
  } catch (error) {
    console.error("[verifyReceiptControllers.getReceiptSummary]", {
      reference,
      error: error instanceof Error ? error.message : error,
    });
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};