import { Request, Response }  from "express";
import { prisma }             from "../lib/prisma";
import {
  paystackInitialize,
  paystackVerify,
  generateReference,
} from "../lib/paystack";
import {
  verifyPaystackSignature,
  calculateCommission,
} from "../lib/paymentUtils";
import {
  notifyPaymentSuccess,
  notifyPaymentFailed,
} from "../lib/notificationService";
import { logSystemEvent } from "../lib/auditService";

// ── COMMISSION RATE ────────────────────────────────────────────────────────────
const getCommissionRate = (): number => {
  const raw = Number(process.env.COMMISSION_PERCENTAGE);
  return Number.isFinite(raw) && raw > 0 ? raw : 5;
};

// ── INITIALIZE PAYMENT ────────────────────────────────────────────────────────

export const initializePayment = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { leaseId, amount, email } = req.body;

    if (!leaseId || !amount || !email) {
      res.status(400).json({ message: "leaseId, amount, and email are required" });
      return;
    }

    if (typeof amount !== "number" || amount <= 0) {
      res.status(400).json({ message: "amount must be a positive number" });
      return;
    }

    const lease = await prisma.lease.findUnique({
      where:   { id: Number(leaseId) },
      include: { property: true, tenant: true },
    });

    if (!lease) {
      res.status(404).json({ message: "Lease not found" });
      return;
    }

    const reference = generateReference(Number(leaseId));

    const data = await paystackInitialize({
      email,
      amount,
      reference,
      metadata: {
        leaseId:        Number(leaseId),
        propertyId:     lease.propertyId,
        tenantClerkId:  lease.tenantClerkId,
        propertyName:   lease.property?.name          ?? "Property",
        managerClerkId: lease.property?.managerClerkId ?? "",
      },
    });

    // Create pending Transaction record immediately
    await prisma.transaction.create({
      data: {
        paystackReference: reference,
        amount,
        currency:          "GHS",
        status:            "Pending",
        type:              "RentPayment",
        tenantClerkId:     lease.tenantClerkId,
        leaseId:           Number(leaseId),
        metadata:          { leaseId: Number(leaseId), propertyId: lease.propertyId },
      },
    });

    await logSystemEvent({
      action:  "PAYMENT_INITIALIZED",
      target:  `Lease #${leaseId}`,
      details: `ref: ${reference}, amount: GHS ${amount}`,
    });

    res.status(200).json({ success: true, data });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to initialize payment";
    console.error("❌ Payment initialization error:", message);
    res.status(500).json({ message });
  }
};

// ── VERIFY PAYMENT ────────────────────────────────────────────────────────────

export const verifyPayment = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { reference } = req.params;

    if (!reference) {
      res.status(400).json({ message: "Payment reference is required" });
      return;
    }

    const paystackData = await paystackVerify(reference);

    if (paystackData.status !== "success") {
      await prisma.transaction.updateMany({
        where: { paystackReference: reference },
        data:  { status: "Failed" },
      });
      res.status(400).json({
        success: false,
        message: `Payment status is: ${paystackData.status}`,
      });
      return;
    }

    // Idempotency — skip if already processed
    const existing = await prisma.payment.findFirst({
      where: { paystackReference: reference },
    });

    if (existing) {
      res.status(200).json({
        success: true,
        message: "Payment already recorded",
        data:    paystackData,
      });
      return;
    }

    const { leaseId, managerClerkId } = paystackData.metadata as {
      leaseId:        number;
      managerClerkId: string;
    };

    const amountGHS = paystackData.amount / 100;

    const payment = await prisma.payment.create({
      data: {
        leaseId:           Number(leaseId),
        amountDue:         amountGHS,
        amountPaid:        amountGHS,
        dueDate:           new Date(),
        paymentDate:       new Date(paystackData.paidAt),
        paymentStatus:     "Paid",
        paystackReference: reference,
      },
    });

    await prisma.transaction.updateMany({
      where: { paystackReference: reference },
      data:  {
        status:    "Success",
        channel:   paystackData.channel,
        paidAt:    new Date(paystackData.paidAt),
        paymentId: payment.id,
      },
    });

    // Commission
    const transaction = await prisma.transaction.findFirst({
      where: { paystackReference: reference },
    });

    if (transaction && managerClerkId) {
      const { commissionAmount, landlordAmount } = calculateCommission(
        amountGHS,
        getCommissionRate()
      );

      await prisma.commission.create({
        data: {
          transactionId:    transaction.id,
          managerClerkId,
          grossAmount:      amountGHS,
          commissionRate:   getCommissionRate() / 100,
          commissionAmount,
          netAmount:        landlordAmount,
        },
      });
    }

    await logSystemEvent({
      action:  "PAYMENT_SUCCESS",
      target:  `Payment #${payment.id}`,
      details: `ref: ${reference}, amount: GHS ${amountGHS}`,
    });

    res.status(200).json({
      success: true,
      message: "Payment verified and recorded",
      payment,
      data:    paystackData,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to verify payment";
    console.error("❌ Payment verification error:", message);
    res.status(500).json({ message });
  }
};

// ── GET PAYMENTS BY LEASE ─────────────────────────────────────────────────────

export const getPaymentsByLease = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { leaseId } = req.params;
    const payments = await prisma.payment.findMany({
      where:   { leaseId: Number(leaseId) },
      orderBy: { dueDate: "desc" },
    });
    res.status(200).json(payments);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to fetch payments";
    res.status(500).json({ message });
  }
};

// ── GET TRANSACTIONS BY TENANT ────────────────────────────────────────────────

export const getTransactionsByTenant = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { tenantClerkId } = req.params;
    const transactions = await prisma.transaction.findMany({
      where:   { tenantClerkId },
      include: { lease: { include: { property: true } } },
      orderBy: { createdAt: "desc" },
    });
    res.status(200).json(transactions);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to fetch transactions";
    res.status(500).json({ message });
  }
};

// ── GET EARNINGS BY MANAGER ───────────────────────────────────────────────────

export const getEarningsByManager = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { managerClerkId } = req.params;

    const commissions = await prisma.commission.findMany({
      where:   { managerClerkId },
      include: {
        transaction: {
          include: { lease: { include: { property: true } } },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    const totalGross      = commissions.reduce((sum, c) => sum + c.grossAmount,      0);
    const totalCommission = commissions.reduce((sum, c) => sum + c.commissionAmount, 0);
    const totalNet        = commissions.reduce((sum, c) => sum + c.netAmount,        0);

    res.status(200).json({
      commissions,
      summary: {
        totalGross,
        totalCommission,
        totalNet,
        totalTransactions: commissions.length,
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to fetch earnings";
    res.status(500).json({ message });
  }
};

// ── GET PAYMENT STATUS ────────────────────────────────────────────────────────

export const getPaymentStatus = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { reference } = req.params;

    const payment = await prisma.payment.findFirst({
      where: { paystackReference: reference },
    });

    if (!payment) {
      res.status(404).json({ message: "Payment not found" });
      return;
    }

    res.status(200).json({ status: payment.paymentStatus, payment });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to fetch payment status";
    res.status(500).json({ message });
  }
};