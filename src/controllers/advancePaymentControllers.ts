// ─────────────────────────────────────────────────────────────────────────────
//  advancePaymentControllers.ts
//
//  Handles advance rent payments on AskDerek.
//
//  The Ghana Problem This Solves:
//    Landlords demand 1 or 2 years rent upfront.
//    Tenants pay a lump sum that covers multiple months.
//    The system must split this into individual monthly records
//    so reminders, overdue checks and dashboards work correctly.
//
//  Business rules enforced:
//    — Amount paid must equal exactly N full months of rent
//    — Floating point tolerance of GHS 0.01 applied to division
//    — Minimum 1 month — maximum 24 months advance
//    — Monthly records created for every month covered
//    — All created records immediately marked as PAID and LOCKED
//    — Existing payment records for covered months not duplicated
//    — Commission calculated on full advance amount — 5%
//    — Lease end date updated to reflect full coverage period
//    — Audit log on every advance payment action
//    — Identity always from JWT — never from req.body
// ─────────────────────────────────────────────────────────────────────────────

import { Request, Response }           from "express";
import { z }                           from "zod";
import { prisma }                      from "../lib/prisma";
import { logUserEvent }                from "../lib/auditService";
import { addMonths, startOfMonth, endOfMonth } from "date-fns";

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

const splitAdvancePaymentSchema = z.object({
  leaseId:           z.number({ error: "leaseId must be a number" })
                      .int()
                      .positive(),
  totalAmountPaid:   z.number({ error: "totalAmountPaid must be a number" })
                      .positive("totalAmountPaid must be greater than zero"),
  paystackReference: z.string()
                      .min(1, "paystackReference is required"),
  startMonth:        z.string()
                      .datetime({ message: "startMonth must be a valid ISO datetime" }),
});

const calculateCoverageSchema = z.object({
  leaseId:         z.number({ error: "leaseId must be a number" })
                    .int()
                    .positive(),
  totalAmountPaid: z.number({ error: "totalAmountPaid must be a number" })
                    .positive(),
});

// ── SHARED HELPERS ────────────────────────────────────────────────────────────

// Extracts userId from verified Clerk JWT.
// Identity must always come from token — never from req.body.
const requireAuth = (req: Request, res: Response): string | null => {
  const userId = req.auth?.userId;
  if (!userId) {
    res.status(401).json({ success: false, message: "Unauthorized" });
    return null;
  }
  return userId;
};

// Validates a numeric route parameter.
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

// Calculates months covered with floating point tolerance.
// JavaScript floating point means 2100 / 700 = 2.9999...
// Math.round fixes this. Tolerance of GHS 0.01 catches rounding.
// Returns null if amount does not divide evenly.
const FLOAT_TOLERANCE = 0.01;

const getMonthsCovered = (
  totalAmount:  number,
  monthlyRent:  number
): number | null => {
  const months    = Math.round(totalAmount / monthlyRent);
  const remainder = Math.abs(totalAmount - (months * monthlyRent));
  return remainder <= FLOAT_TOLERANCE ? months : null;
};

// ─────────────────────────────────────────────────────────────────────────────
//  SPLIT ADVANCE PAYMENT
//  POST /api/advance-payments/split
//
//  Core function — splits a lump sum advance payment into monthly records.
//
//  Example:
//    Tenant pays GHS 16,800 for a GHS 700/month house.
//    System creates 24 Payment records all marked PAID and LOCKED.
//    Lease end date updated to cover all 24 months.
//    No overdue alerts for 24 months.
//    Renewal SMS sent 60 days before coverage ends.
//
//  Edge cases handled:
//    — Floating point tolerance prevents false rejections
//    — Cannot create duplicate payment records for same month
//    — Maximum 24 months advance allowed
//    — Lease must be ACTIVE to receive advance payment
//    — Commission calculated on full advance amount
//    — All records created atomically — no partial state
// ─────────────────────────────────────────────────────────────────────────────
export const splitAdvancePayment = async (
  req: Request,
  res: Response<ApiResponse>
): Promise<void> => {
  const tenantClerkId = requireAuth(req, res);
  if (!tenantClerkId) return;

  const parsed = splitAdvancePaymentSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      success: false,
      message: "Validation failed",
      errors:  formatZodErrors(parsed.error.issues),
    });
    return;
  }

  const { leaseId, totalAmountPaid, paystackReference, startMonth } = parsed.data;

  try {
    // Fetch lease with property — needed for rent amount and authorization
    const lease = await prisma.lease.findFirst({
      where: {
        id:            leaseId,
        tenantClerkId,
        status:        "ACTIVE",
      },
      include: {
        property: {
          select: {
            id:             true,
            managerClerkId: true,
            pricePerMonth:  true,
          },
        },
      },
    });

    if (!lease) {
      res.status(404).json({
        success: false,
        message: "Active lease not found or you do not have permission",
      });
      return;
    }

    const monthlyRent   = lease.property.pricePerMonth;
    const monthsCovered = getMonthsCovered(totalAmountPaid, monthlyRent);

    // Amount must divide evenly into whole months — floating point safe
    if (monthsCovered === null) {
      res.status(400).json({
        success: false,
        message: `Payment of GHS ${totalAmountPaid} does not divide evenly into months of GHS ${monthlyRent}. Please pay an exact multiple of the monthly rent.`,
      });
      return;
    }

    // Maximum 24 months advance — prevents abuse
    if (monthsCovered > 24) {
      res.status(400).json({
        success: false,
        message: "Maximum advance payment is 24 months",
      });
      return;
    }

    // Minimum 1 month
    if (monthsCovered < 1) {
      res.status(400).json({
        success: false,
        message: "Advance payment must cover at least 1 month",
      });
      return;
    }

    const startDate = new Date(startMonth);

    // Check for existing records in covered period — prevents duplicates
    const existingPayments = await prisma.payment.findMany({
      where: {
        leaseId,
        dueDate: {
          gte: startOfMonth(startDate),
          lte: endOfMonth(addMonths(startDate, monthsCovered - 1)),
        },
      },
    });

    if (existingPayments.length > 0) {
      res.status(400).json({
        success: false,
        message: `${existingPayments.length} payment record(s) already exist for the covered period. Cannot create duplicates.`,
      });
      return;
    }

    const commissionAmount = totalAmountPaid * 0.05;
    const landlordAmount   = totalAmountPaid * 0.95;

    // Create all monthly records atomically — all or nothing
    const createdPayments = await prisma.$transaction(async (tx) => {
      const payments = [];

      for (let i = 0; i < monthsCovered; i++) {
        const monthDate  = addMonths(startDate, i);
        const dueDate    = startOfMonth(monthDate);
        const paymentRef = i === 0
          ? paystackReference
          : `${paystackReference}_month_${i + 1}`;

        const payment = await tx.payment.create({
          data: {
            leaseId,
            amountDue:         monthlyRent,
            amountPaid:        monthlyRent,
            dueDate,
            paymentDate:       new Date(),
            paymentStatus:     "Paid",
            paystackReference: paymentRef,
            isLocked:          true,
            lockedAt:          new Date(),
          },
        });

        payments.push(payment);
      }

      // Update lease end date to reflect full advance coverage
      const newEndDate = endOfMonth(addMonths(startDate, monthsCovered - 1));
      await tx.lease.update({
        where: { id: leaseId },
        data:  { endDate: newEndDate },
      });

      return payments;
    });

    // Audit log fires AFTER transaction — never inside it
    await logUserEvent({
      userClerkId: tenantClerkId,
      action:      "ADVANCE_PAYMENT_SPLIT",
      target:      `Lease #${leaseId}`,
      details:     `GHS ${totalAmountPaid} split into ${monthsCovered} monthly records. Commission: GHS ${commissionAmount}. Net: GHS ${landlordAmount}`,
    });

    res.status(201).json({
      success: true,
      message: `Advance payment of GHS ${totalAmountPaid} split into ${monthsCovered} monthly records`,
      data: {
        monthsCovered,
        monthlyRent,
        totalAmountPaid,
        commissionAmount,
        landlordReceives: landlordAmount,
        paymentsCreated:  createdPayments.length,
        coverageStart:    startDate,
        coverageEnd:      endOfMonth(addMonths(startDate, monthsCovered - 1)),
      },
    });
  } catch (error) {
    console.error("[advancePaymentControllers.splitAdvancePayment]", {
      leaseId,
      tenantClerkId,
      error: error instanceof Error ? error.message : error,
    });
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
//  CALCULATE COVERAGE
//  POST /api/advance-payments/calculate
//
//  Calculates how many months a given amount covers before payment.
//  No database writes — pure calculation with lease rent amount.
//  Used by frontend to show tenant exactly what they are paying for.
//
//  Example:
//    Tenant enters GHS 8,400 for a GHS 700/month lease.
//    System shows: "This covers 12 months until December 2026"
// ─────────────────────────────────────────────────────────────────────────────
export const calculateCoverage = async (
  req: Request,
  res: Response<ApiResponse>
): Promise<void> => {
  const tenantClerkId = requireAuth(req, res);
  if (!tenantClerkId) return;

  const parsed = calculateCoverageSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      success: false,
      message: "Validation failed",
      errors:  formatZodErrors(parsed.error.issues),
    });
    return;
  }

  const { leaseId, totalAmountPaid } = parsed.data;

  try {
    const lease = await prisma.lease.findFirst({
      where: {
        id:            leaseId,
        tenantClerkId,
        status:        "ACTIVE",
      },
      include: {
        property: {
          select: { pricePerMonth: true },
        },
      },
    });

    if (!lease) {
      res.status(404).json({
        success: false,
        message: "Active lease not found",
      });
      return;
    }

    const monthlyRent      = lease.property.pricePerMonth;
    const monthsCovered    = getMonthsCovered(totalAmountPaid, monthlyRent);
    const isValidAmount    = monthsCovered !== null;
    const now              = new Date();
    const coverageEnd      = isValidAmount && monthsCovered !== null
      ? endOfMonth(addMonths(now, monthsCovered - 1))
      : null;

    const commissionAmount = totalAmountPaid * 0.05;
    const landlordAmount   = totalAmountPaid * 0.95;

    const validationMessage = !isValidAmount
      ? `GHS ${totalAmountPaid} does not divide evenly into GHS ${monthlyRent} monthly payments`
      : monthsCovered! > 24
      ? "Maximum advance payment is 24 months"
      : `This covers ${monthsCovered} month(s) until ${coverageEnd?.toISOString().split("T")[0]}`;

    res.status(200).json({
      success: true,
      message: "Coverage calculated",
      data: {
        monthlyRent,
        totalAmountPaid,
        monthsCovered,
        isValidAmount,
        coverageEnd,
        commissionAmount,
        landlordReceives:  landlordAmount,
        isWithinLimit:     monthsCovered !== null && monthsCovered <= 24,
        validationMessage,
      },
    });
  } catch (error) {
    console.error("[advancePaymentControllers.calculateCoverage]", {
      leaseId,
      tenantClerkId,
      error: error instanceof Error ? error.message : error,
    });
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
//  GET PAYMENT COVERAGE
//  GET /api/advance-payments/coverage/:leaseId
//
//  Returns full payment coverage status for a lease.
//  Shows paid months, overdue months, pending months and expiry date.
//  isExpiringSoon = true when coverage ends within 60 days.
//  Used by tenant and manager dashboards to show payment health.
// ─────────────────────────────────────────────────────────────────────────────
export const getPaymentCoverage = async (
  req: Request,
  res: Response<ApiResponse>
): Promise<void> => {
  const tenantClerkId = requireAuth(req, res);
  if (!tenantClerkId) return;

  const leaseId = getNumericParam(req.params.leaseId, "leaseId", res);
  if (!leaseId) return;

  try {
    const lease = await prisma.lease.findFirst({
      where: {
        id:            leaseId,
        tenantClerkId,
      },
      include: {
        property: {
          select: {
            id:            true,
            name:          true,
            pricePerMonth: true,
          },
        },
        payments: {
          orderBy: { dueDate: "asc" },
          select: {
            id:            true,
            dueDate:       true,
            amountDue:     true,
            amountPaid:    true,
            paymentStatus: true,
            isLocked:      true,
          },
        },
      },
    });

    if (!lease) {
      res.status(404).json({
        success: false,
        message: "Lease not found",
      });
      return;
    }

    const now           = new Date();
    const paidMonths    = lease.payments.filter(p => p.paymentStatus === "Paid");
    const overdueMonths = lease.payments.filter(p => p.paymentStatus === "Overdue");
    const pendingMonths = lease.payments.filter(p => p.paymentStatus === "Pending");

    // Last paid month determines coverage end date
    const lastPaidPayment = paidMonths.length > 0
      ? paidMonths[paidMonths.length - 1]
      : null;

    const coverageEnd = lastPaidPayment
      ? endOfMonth(new Date(lastPaidPayment.dueDate))
      : null;

    const daysUntilExpiry = coverageEnd
      ? Math.ceil((coverageEnd.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
      : null;

    // Alert tenant when coverage ends within 60 days
    const isExpiringSoon = daysUntilExpiry !== null && daysUntilExpiry <= 60;

    res.status(200).json({
      success: true,
      message: "Payment coverage retrieved",
      data: {
        leaseId,
        property:       lease.property,
        monthlyRent:    lease.property.pricePerMonth,
        leaseStart:     lease.startDate,
        leaseEnd:       lease.endDate,
        coverageEnd,
        daysUntilExpiry,
        isExpiringSoon,
        summary: {
          totalMonths:   lease.payments.length,
          paidMonths:    paidMonths.length,
          overdueMonths: overdueMonths.length,
          pendingMonths: pendingMonths.length,
        },
        payments: lease.payments,
      },
    });
  } catch (error) {
    console.error("[advancePaymentControllers.getPaymentCoverage]", {
      leaseId,
      tenantClerkId,
      error: error instanceof Error ? error.message : error,
    });
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};