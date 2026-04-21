import { Request, Response } from "express";
import { prisma }            from "../lib/prisma";
import { formatGHS, generateCashReference } from "../lib/paymentUtils";
import { logSystemEvent }    from "../lib/auditService";
import { notifyCashPaymentRecorded } from "../lib/notificationService";

// ─────────────────────────────────────────────────────────────────────────────
//  adminPaymentControllers.ts
//
//  Full admin visibility and control over all payments.
//  Only accessible by Admin role.
//
//  Functions:
//  - getAllPayments       — paginated list of all payments
//  - getPaymentByRef     — single payment full detail
//  - getPlatformRevenue  — total commission earned
//  - overrideStatus      — manually change payment status
//  - recordCashPayment   — record offline cash payment
// ─────────────────────────────────────────────────────────────────────────────

// ── GET ALL PAYMENTS ──────────────────────────────────────
export const getAllPayments = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const page   = Number(req.query.page)   || 1;
    const limit  = Number(req.query.limit)  || 20;
    const status = req.query.status as string | undefined;
    const skip   = (page - 1) * limit;

    const where: any = {};
    if (status) where.paymentStatus = status;

    const [payments, total] = await Promise.all([
      prisma.payment.findMany({
        where,
        include: {
          lease: {
            include: {
              property: { include: { location: true } },
              tenant:   { include: { user: true } },
            },
          },
          transactions: true,
          logs:         true,
        },
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
      prisma.payment.count({ where }),
    ]);

    res.status(200).json({
      payments,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error: any) {
    res.status(500).json({ message: `Error fetching payments: ${error.message}` });
  }
};

// ── GET SINGLE PAYMENT BY REFERENCE ──────────────────────
export const getPaymentByRef = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { reference } = req.params;

    const payment = await prisma.payment.findFirst({
      where: { paystackReference: reference },
      include: {
        lease: {
          include: {
            property: {
              include: {
                location: true,
                manager: { include: { user: true } },
              },
            },
            tenant: { include: { user: true } },
          },
        },
        transactions: { include: { commission: true } },
        logs:         true,
      },
    });

    if (!payment) {
      res.status(404).json({ message: "Payment not found" });
      return;
    }

    res.status(200).json(payment);
  } catch (error: any) {
    res.status(500).json({ message: `Error fetching payment: ${error.message}` });
  }
};

// ── GET PLATFORM REVENUE ──────────────────────────────────
export const getPlatformRevenue = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const commissions = await prisma.commission.findMany();
    const payments    = await prisma.payment.findMany({
      where: { paymentStatus: "Paid" },
    });

    const totalRevenue    = commissions.reduce((s, c) => s + c.commissionAmount, 0);
    const totalGross      = commissions.reduce((s, c) => s + c.grossAmount,      0);
    const totalNetPaid    = commissions.reduce((s, c) => s + c.netAmount,        0);
    const totalPayments   = payments.length;
    const averagePayment  = totalPayments > 0
      ? totalGross / totalPayments
      : 0;

    res.status(200).json({
      revenue: {
        totalCommissionEarned: formatGHS(totalRevenue),
        totalRentProcessed:    formatGHS(totalGross),
        totalPaidToLandlords:  formatGHS(totalNetPaid),
        totalSuccessPayments:  totalPayments,
        averagePaymentAmount:  formatGHS(averagePayment),
      },
    });
  } catch (error: any) {
    res.status(500).json({ message: `Error fetching revenue: ${error.message}` });
  }
};

// ── OVERRIDE PAYMENT STATUS ───────────────────────────────
export const overridePaymentStatus = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { reference }             = req.params;
    const { newStatus, reason, adminClerkId } = req.body;

    if (!newStatus || !reason || !adminClerkId) {
      res.status(400).json({
        message: "newStatus, reason and adminClerkId are required",
      });
      return;
    }

    const payment = await prisma.payment.findFirst({
      where: { paystackReference: reference },
    });

    if (!payment) {
      res.status(404).json({ message: "Payment not found" });
      return;
    }

    const previousStatus = payment.paymentStatus;

    await prisma.payment.update({
      where: { id: payment.id },
      data:  { paymentStatus: newStatus as any },
    });

    await prisma.paymentLog.create({
      data: {
        paymentId:      payment.id,
        action:         "ADMIN_OVERRIDE",
        previousStatus,
        newStatus,
        performedBy:    adminClerkId,
        notes:          reason,
      },
    });

    await logSystemEvent({
      action:  "ADMIN_OVERRIDE",
      target:  `Payment ref: ${reference}`,
      details: `${previousStatus} → ${newStatus} by ${adminClerkId}. Reason: ${reason}`,
    });

    res.status(200).json({
      message:         "Payment status updated successfully",
      reference,
      previousStatus,
      newStatus,
    });
  } catch (error: any) {
    res.status(500).json({ message: `Error overriding payment: ${error.message}` });
  }
};

// ── RECORD CASH PAYMENT ───────────────────────────────────
export const recordCashPayment = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const {
      leaseId,
      amountPaid,
      dueDate,
      adminClerkId,
      notes,
    } = req.body;

    if (!leaseId || !amountPaid || !dueDate || !adminClerkId) {
      res.status(400).json({
        message: "leaseId, amountPaid, dueDate and adminClerkId are required",
      });
      return;
    }

    const lease = await prisma.lease.findUnique({
      where:   { id: Number(leaseId) },
      include: {
        tenant:   { include: { user: true } },
        property: true,
      },
    });

    if (!lease) {
      res.status(404).json({ message: "Lease not found" });
      return;
    }

    const reference = generateCashReference();

    // ── Create payment record ──
    const payment = await prisma.payment.create({
      data: {
        leaseId:           Number(leaseId),
        amountDue:         Number(amountPaid),
        amountPaid:        Number(amountPaid),
        dueDate:           new Date(dueDate),
        paymentDate:       new Date(),
        paymentStatus:     "Paid",
        paystackReference: reference,
      },
    });

    // ── Audit log ──
    await prisma.paymentLog.create({
      data: {
        paymentId:   payment.id,
        action:      "CASH_PAYMENT_RECORDED",
        newStatus:   "Paid",
        performedBy: adminClerkId,
        notes:       notes || "Cash payment recorded by admin",
      },
    });

    await logSystemEvent({
      action:  "CASH_PAYMENT_RECORDED",
      target:  `Lease #${leaseId}`,
      details: `Cash payment of ${formatGHS(Number(amountPaid))} recorded. Ref: ${reference}`,
    });

    // ── Notify tenant ──
    try {
      await notifyCashPaymentRecorded({
        tenantName:   lease.tenant.user.name,
        tenantEmail:  lease.tenant.user.email,
        tenantPhone:  lease.tenant.user.phoneNumber || undefined,
        propertyName: lease.property.name,
        amountPaid:   Number(amountPaid),
        reference,
        recordedBy:   adminClerkId,
      });
    } catch (err) {
      console.error("❌ Cash payment notification error:", err);
    }

    res.status(201).json({
      message:   "Cash payment recorded successfully",
      reference,
      payment,
    });
  } catch (error: any) {
    res.status(500).json({ message: `Error recording cash payment: ${error.message}` });
  }
};