import { Request, Response } from "express";
import { prisma }            from "../lib/prisma";
import { formatGHS, formatDateShort } from "../lib/paymentUtils";

// ─────────────────────────────────────────────────────────────────────────────
//  receiptControllers.ts
//
//  Generates payment receipts for tenants and landlords.
//  Called after every successful payment.
//
//  Receipt contains:
//  - Transaction reference
//  - Property details
//  - Tenant and landlord details
//  - Amount breakdown (total, commission, landlord amount)
//  - Payment method and date
//  - WhatsApp share link
// ─────────────────────────────────────────────────────────────────────────────

// ── GET RECEIPT BY REFERENCE ──────────────────────────────
export const getReceipt = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { reference } = req.params;

    if (!reference) {
      res.status(400).json({ message: "Payment reference is required" });
      return;
    }

    // ── Fetch payment with full context ──────────────────
    const payment = await prisma.payment.findFirst({
      where: { paystackReference: reference },
      include: {
        lease: {
          include: {
            property: {
              include: {
                location: true,
                manager: {
                  include: { user: true },
                },
              },
            },
            tenant: {
              include: { user: true },
            },
          },
        },
      },
    });

    if (!payment) {
      res.status(404).json({ message: "Receipt not found for this reference" });
      return;
    }

    if (payment.paymentStatus !== "Paid") {
      res.status(400).json({
        message: "Receipt only available for successful payments",
        status: payment.paymentStatus,
      });
      return;
    }

    // ── Fetch commission for this payment ─────────────────
    const transaction = await prisma.transaction.findFirst({
      where: { paystackReference: reference },
      include: { commission: true },
    });

    const commission = transaction?.commission;

    // ── Build receipt data ────────────────────────────────
    const lease    = payment.lease;
    const property = lease.property;
    const location = property.location;
    const tenant   = lease.tenant.user;
    const landlord = property.manager.user;

    const commissionAmount = commission?.commissionAmount ?? payment.amountPaid * 0.05;
    const landlordAmount   = commission?.netAmount        ?? payment.amountPaid * 0.95;

    const receipt = {
      // ── Reference ──
      reference:       payment.paystackReference,
      receiptNumber:   `RCP-${payment.id}-${Date.now()}`,

      // ── Property ──
      property: {
        name:    property.name,
        address: location.address,
        city:    location.city,
        region:  location.region,
        area:    location.area,
      },

      // ── Tenant ──
      tenant: {
        name:  tenant.name,
        email: tenant.email,
      },

      // ── Landlord ──
      landlord: {
        name:  landlord.name,
        email: landlord.email,
      },

      // ── Payment ──
      payment: {
        totalAmount:      formatGHS(payment.amountPaid),
        commissionAmount: formatGHS(commissionAmount),
        commissionRate:   "5%",
        landlordAmount:   formatGHS(landlordAmount),
        paymentDate:      payment.paymentDate
          ? formatDateShort(payment.paymentDate)
          : formatDateShort(new Date()),
        dueDate:          formatDateShort(payment.dueDate),
        status:           payment.paymentStatus,
        method:           transaction?.channel ?? "Paystack",
      },

      // ── Share links ──
      shareLinks: {
        whatsapp: `https://wa.me/?text=${encodeURIComponent(
          `AskDerek Payment Receipt\n` +
          `Property: ${property.name}\n` +
          `Amount: ${formatGHS(payment.amountPaid)}\n` +
          `Reference: ${payment.paystackReference}\n` +
          `Date: ${payment.paymentDate ? formatDateShort(payment.paymentDate) : ""}\n` +
          `Verify at: https://askderek.com/payment/receipt/${payment.paystackReference}`
        )}`,
        receiptUrl: `https://askderek.com/payment/receipt/${payment.paystackReference}`,
      },

      generatedAt: new Date().toISOString(),
    };

    res.status(200).json(receipt);
  } catch (error: any) {
    console.error("❌ Receipt error:", error.message);
    res.status(500).json({ message: `Error generating receipt: ${error.message}` });
  }
};

// ── GET ALL RECEIPTS BY TENANT ────────────────────────────
export const getTenantReceipts = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { tenantClerkId } = req.params;

    const payments = await prisma.payment.findMany({
      where: {
        paymentStatus: "Paid",
        lease: { tenantClerkId },
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
      orderBy: { paymentDate: "desc" },
    });

    const receipts = payments.map((payment) => ({
      reference:     payment.paystackReference,
      propertyName:  payment.lease.property.name,
      propertyCity:  payment.lease.property.location.city,
      amountPaid:    formatGHS(payment.amountPaid),
      paymentDate:   payment.paymentDate
        ? formatDateShort(payment.paymentDate)
        : null,
      receiptUrl:    `https://askderek.com/payment/receipt/${payment.paystackReference}`,
    }));

    res.status(200).json(receipts);
  } catch (error: any) {
    console.error("❌ Tenant receipts error:", error.message);
    res.status(500).json({ message: `Error fetching receipts: ${error.message}` });
  }
};