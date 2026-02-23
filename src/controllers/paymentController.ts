import crypto from "crypto";
import { Request, Response } from "express";
import { prisma } from "../lib/prisma";
import axios from "axios";

export const initializePayment = async (req: Request, res: Response): Promise<void> => {
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
      where: { id: Number(leaseId) },
      include: { property: true, tenant: true },
    });

    if (!lease) { res.status(404).json({ message: "Lease not found" }); return; }

    if (!process.env.PAYSTACK_SECRET_KEY) {
      res.status(500).json({ message: "Payment service is not configured" });
      return;
    }

    const reference = `LEASE_${leaseId}_${Date.now()}`;

    const response = await axios.post(
      "https://api.paystack.co/transaction/initialize",
      {
        email,
        amount: Math.round(amount * 100),
        currency: "GHS",
        reference,
        callback_url: `${process.env.CLIENT_URL}/payment/verify`,
        metadata: {
          leaseId: Number(leaseId),
          propertyId: lease.propertyId,
          tenantId: lease.tenantClerkId,
          propertyName: lease.property?.name ?? "Property",
        },
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
          "Content-Type": "application/json",
        },
      }
    );

    res.status(200).json({ success: true, data: response.data.data });
  } catch (error: any) {
    console.error("❌ Payment initialization error:", error.response?.data || error.message);
    res.status(500).json({ message: "Failed to initialize payment", error: error.response?.data?.message || error.message });
  }
};

export const verifyPayment = async (req: Request, res: Response): Promise<void> => {
  try {
    const { reference } = req.params;
    if (!reference) { res.status(400).json({ message: "Payment reference is required" }); return; }

    const response = await axios.get(
      `https://api.paystack.co/transaction/verify/${reference}`,
      { headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` } }
    );

    const data = response.data.data;

    if (data.status !== "success") {
      res.status(400).json({ success: false, message: `Payment status is: ${data.status}` });
      return;
    }

    const { leaseId } = data.metadata;

    const existingPayment = await prisma.payment.findFirst({
      where: { paystackReference: reference },
    });

    if (existingPayment) {
      res.status(200).json({ success: true, message: "Payment already recorded", data });
      return;
    }

    const payment = await prisma.payment.create({
      data: {
        leaseId: Number(leaseId),
        amountDue: data.amount / 100,
        amountPaid: data.amount / 100,
        dueDate: new Date(),
        paymentDate: new Date(),
        paymentStatus: "Paid",
        paystackReference: reference,
      },
    });

    res.status(200).json({ success: true, message: "Payment verified and recorded", payment, data });
  } catch (error: any) {
    console.error("❌ Payment verification error:", error.response?.data || error.message);
    res.status(500).json({ message: "Failed to verify payment", error: error.response?.data?.message || error.message });
  }
};

export const paystackWebhook = async (req: Request, res: Response): Promise<void> => {
  try {
    const secret = process.env.PAYSTACK_SECRET_KEY!;
    const signature = req.headers["x-paystack-signature"] as string;
    const hash = crypto.createHmac("sha512", secret).update(JSON.stringify(req.body)).digest("hex");
    if (hash !== signature) { res.sendStatus(401); return; }

    const event = req.body;
    console.log(`📦 Paystack webhook: ${event.event}`);

    if (event.event === "charge.success") {
      const { leaseId } = event.data.metadata;
      const reference = event.data.reference;

      const existingPayment = await prisma.payment.findFirst({
        where: { paystackReference: reference },
      });

      if (!existingPayment) {
        await prisma.payment.create({
          data: {
            leaseId: Number(leaseId),
            amountDue: event.data.amount / 100,
            amountPaid: event.data.amount / 100,
            dueDate: new Date(),
            paymentDate: new Date(),
            paymentStatus: "Paid",
            paystackReference: reference,
          },
        });
        console.log(`✅ Payment recorded from webhook for lease ${leaseId}`);
      }
    }

    res.sendStatus(200);
  } catch (error: any) {
    console.error("❌ Webhook error:", error.message);
    res.sendStatus(500);
  }
};

export const getPaymentsByLease = async (req: Request, res: Response): Promise<void> => {
  try {
    const { leaseId } = req.params;
    const payments = await prisma.payment.findMany({
      where: { leaseId: Number(leaseId) },
      orderBy: { dueDate: "desc" },
    });
    res.status(200).json(payments);
  } catch (error: any) {
    res.status(500).json({ message: "Failed to fetch payments" });
  }
};