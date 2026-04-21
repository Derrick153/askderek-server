import { Request, Response }                           from "express";
import { prisma }                                       from "../lib/prisma";
import { Webhook }                                      from "svix";
import { verifyPaystackSignature, calculateCommission } from "../lib/paymentUtils";
import { notifyPaymentSuccess, notifyPaymentFailed }    from "../lib/notificationService";
import { logSystemEvent }                               from "../lib/auditService";

// ── Extend Express Request to include rawBody ──────────────
declare global {
  namespace Express {
    interface Request {
      rawBody?: Buffer;
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  webhookControllers.ts
//
//  Handles ALL incoming webhooks for AskDerek in one file.
//
//  ┌─────────────────────────────────────────────────────────┐
//  │  POST /webhooks/clerk     → handleClerkWebhook          │
//  │  POST /webhooks/paystack  → handlePaystackWebhook        │
//  └─────────────────────────────────────────────────────────┘
//
//  SHARED DESIGN RULES:
//    1. Verify signature FIRST — reject anything that fails, log it
//    2. req.rawBody for ALL signature verification — never JSON.stringify(req.body)
//    3. Respond early for Paystack — 200 before processing (5s timeout rule)
//    4. Never let a failed notification crash a confirmed payment
// ─────────────────────────────────────────────────────────────────────────────

// ── SAFE COMMISSION RATE ───────────────────────────────────
const getCommissionPercent = (): number => {
  const raw = Number(process.env.COMMISSION_PERCENTAGE);
  return Number.isFinite(raw) && raw > 0 ? raw : 5;
};

// ═════════════════════════════════════════════════════════════════════════════
//  CLERK WEBHOOK
// ═════════════════════════════════════════════════════════════════════════════

export const handleClerkWebhook = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const WEBHOOK_SECRET = process.env.CLERK_WEBHOOK_SECRET;
    if (!WEBHOOK_SECRET) {
      res.status(500).json({ error: "Clerk webhook secret not configured" });
      return;
    }

    const svix_id        = req.headers["svix-id"]        as string;
    const svix_timestamp = req.headers["svix-timestamp"] as string;
    const svix_signature = req.headers["svix-signature"] as string;

    if (!svix_id || !svix_timestamp || !svix_signature) {
      res.status(400).json({ error: "Missing svix headers" });
      return;
    }

    if (!req.rawBody) {
      console.error("[CLERK] ❌ Missing raw body — rawBodyMiddleware not applied to this route");
      res.status(400).json({ error: "Missing raw body" });
      return;
    }

    const wh  = new Webhook(WEBHOOK_SECRET);
    let evt: any;

    try {
      evt = wh.verify(req.rawBody.toString(), {
        "svix-id":        svix_id,
        "svix-timestamp": svix_timestamp,
        "svix-signature": svix_signature,
      });
    } catch (err) {
      console.error("[CLERK] ❌ Signature verification failed:", err);
      res.status(400).json({ error: "Webhook verification failed" });
      return;
    }

    const { type, data } = evt;
    console.log(`[CLERK] 📩 Received: ${type}`);

    switch (type) {
      case "user.created": await handleUserCreated(data); break;
      case "user.updated": await handleUserUpdated(data); break;
      case "user.deleted": await handleUserDeleted(data); break;
      default:
        console.log(`[CLERK] ℹ️ Unhandled event type: ${type}`);
    }

    res.status(200).json({ success: true, type });
  } catch (error) {
    console.error("[CLERK] ❌ Unexpected error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

// ── user.created ───────────────────────────────────────────
async function handleUserCreated(data: any): Promise<void> {
  const {
    id,
    email_addresses,
    first_name,
    last_name,
    phone_numbers,
    public_metadata,
  } = data;

  const email       = email_addresses?.[0]?.email_address || "";
  const name        = `${first_name || ""} ${last_name || ""}`.trim() || "User";
  const phoneNumber = phone_numbers?.[0]?.phone_number   || "";
  const userType    = (public_metadata?.userType as string) || "tenant";

  const user = await prisma.user.upsert({
    where:  { clerkId: id },
    update: { email, name, phoneNumber },
    create: {
      clerkId:     id,
      email,
      name,
      phoneNumber,
      role: userType === "admin"
        ? "ADMIN"
        : userType === "manager"
        ? "MANAGER"
        : "TENANT",
    },
  });

  console.log(`[CLERK] ✅ User created/updated: ${user.name} (${user.role})`);

  if (user.role === "ADMIN") return;

  if (user.role === "TENANT") {
    const existing = await prisma.tenant.findUnique({ where: { userId: user.id } });
    if (!existing) {
      await prisma.tenant.create({
        data: { clerkId: id, userId: user.id, phoneNumber },
      });
      console.log(`[CLERK] ✅ Tenant profile created: ${user.name}`);
    }
  }

  if (user.role === "MANAGER") {
    const existing = await prisma.manager.findUnique({ where: { userId: user.id } });
    if (!existing) {
      await prisma.manager.create({
        data: { clerkId: id, userId: user.id },
      });
      console.log(`[CLERK] ✅ Manager profile created: ${user.name}`);
    }
  }
}

// ── user.updated ───────────────────────────────────────────
async function handleUserUpdated(data: any): Promise<void> {
  const { id, email_addresses, first_name, last_name, phone_numbers } = data;

  const email       = email_addresses?.[0]?.email_address || "";
  const name        = `${first_name || ""} ${last_name || ""}`.trim();
  const phoneNumber = phone_numbers?.[0]?.phone_number || "";

  const user = await prisma.user.findUnique({ where: { clerkId: id } });

  if (!user) {
    console.warn(`[CLERK] ⚠️ User not found for update — clerkId: ${id}`);
    return;
  }

  await prisma.user.update({
    where: { clerkId: id },
    data:  {
      ...(name        && { name }),
      ...(email       && { email }),
      ...(phoneNumber && { phoneNumber }),
    },
  });

  console.log(`[CLERK] ✅ User updated: ${id}`);
}

// ── user.deleted ───────────────────────────────────────────
async function handleUserDeleted(data: any): Promise<void> {
  const { id } = data;
  try {
    await prisma.user.delete({ where: { clerkId: id } });
    console.log(`[CLERK] ✅ User deleted: ${id}`);
  } catch (err) {
    console.warn(`[CLERK] ⚠️ Could not delete user ${id}:`, err);
  }
}

// ═════════════════════════════════════════════════════════════════════════════
//  PAYSTACK WEBHOOK
// ═════════════════════════════════════════════════════════════════════════════

export const handlePaystackWebhook = async (
  req: Request,
  res: Response
): Promise<void> => {
  // ✅ Respond 200 immediately — Paystack retries if no response within 5s
  res.sendStatus(200);

  try {
    const signature = req.headers["x-paystack-signature"] as string;
    const rawBody   = req.rawBody;

    if (!rawBody || !signature) {
      console.error("[PAYSTACK] ❌ Missing raw body or signature");
      return;
    }

    const isValid = verifyPaystackSignature(
      rawBody,
      signature,
      process.env.PAYSTACK_SECRET_KEY!
    );

    if (!isValid) {
      console.error("[PAYSTACK] ❌ Invalid signature — possible fraud attempt");
      await logSystemEvent({
        action:  "WEBHOOK_REJECTED",
        target:  "Paystack Webhook",
        details: "HMAC-SHA512 signature verification failed",
      });
      return;
    }

    await logSystemEvent({
      action:  "WEBHOOK_VERIFIED",
      target:  "Paystack Webhook",
      details: `Event: ${req.body?.event}`,
    });

    const event = req.body;
    console.log(`[PAYSTACK] 📦 Received: ${event.event}`);

    switch (event.event) {
      case "charge.success":
        await handleChargeSuccess(event.data);
        break;
      case "charge.failed":
        await handleChargeFailed(event.data);
        break;
      default:
        console.log(`[PAYSTACK] ℹ️ Unhandled event type: ${event.event}`);
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[PAYSTACK] ❌ Processing error:", message);
  }
};

// ── charge.success ─────────────────────────────────────────
const handleChargeSuccess = async (data: any): Promise<void> => {
  const reference     = data.reference  as string;
  const amountPesewas = data.amount     as number;
  const amountGHS     = amountPesewas / 100;
  const channel       = data.channel    as string;
  const paidAt        = new Date(data.paid_at);

  const metadata       = data.metadata       || {};
  const leaseId        = Number(metadata.leaseId);
  const managerClerkId = metadata.managerClerkId as string | undefined;

  console.log(`[PAYSTACK] ✅ charge.success — ref: ${reference}, amount: GH₵ ${amountGHS}`);

  // ── Idempotency check ──
  const existing = await prisma.payment.findFirst({
    where: { paystackReference: reference },
  });

  if (existing?.paymentStatus === "Paid") {
    console.log(`[PAYSTACK] ℹ️ Already processed — skipping: ${reference}`);
    return;
  }

  // ── Fetch lease for notification context ──
  const lease = await prisma.lease.findUnique({
    where:   { id: leaseId },
    include: {
      tenant:   { include: { user: true } },
      property: {
        include: { manager: { include: { user: true } } },
      },
    },
  });

  // ── ✅ FIX: use paidAt for dueDate — lease has no nextDueDate field ──
  const payment = existing
    ? await prisma.payment.update({
        where: { id: existing.id },
        data:  {
          amountPaid:    amountGHS,
          paymentDate:   paidAt,
          paymentStatus: "Paid",
        },
      })
    : await prisma.payment.create({
        data: {
          leaseId,
          amountDue:         amountGHS,
          amountPaid:        amountGHS,
          dueDate:           paidAt,
          paymentDate:       paidAt,
          paymentStatus:     "Paid",
          paystackReference: reference,
        },
      });

  // ── Update Transaction ──
  await prisma.transaction.updateMany({
    where: { paystackReference: reference },
    data:  {
      status:    "Success",
      channel,
      paidAt,
      paymentId: payment.id,
    },
  });

  // ── Record Commission ──
  const transaction = await prisma.transaction.findFirst({
    where: { paystackReference: reference },
  });

  if (transaction && managerClerkId) {
    const existingCommission = await prisma.commission.findUnique({
      where: { transactionId: transaction.id },
    });

    if (!existingCommission) {
      // ✅ FIX: calculateCommission returns { commissionAmount, landlordAmount }
      const commission = calculateCommission(amountGHS, getCommissionPercent());

      await prisma.commission.create({
        data: {
          transactionId:    transaction.id,
          managerClerkId,
          grossAmount:      amountGHS,
          commissionRate:   getCommissionPercent() / 100,
          commissionAmount: commission.commissionAmount,
          netAmount:        commission.landlordAmount,
        },
      });
    }
  }

  // ── Audit log ──
  await logSystemEvent({
    action:  "PAYMENT_SUCCESS",
    target:  `Payment #${payment.id}`,
    details: `ref: ${reference}, amount: GH₵ ${amountGHS}, channel: ${channel}`,
  });

  // ── Notifications ──
  if (lease) {
    try {
      await notifyPaymentSuccess({
        tenantName:   lease.tenant.user.name,
        tenantEmail:  lease.tenant.user.email,
        tenantPhone:  lease.tenant.user.phoneNumber || (lease.tenant as any).phoneNumber || undefined,
        managerName:  lease.property.manager.user.name,
        managerEmail: lease.property.manager.user.email,
        managerPhone: lease.property.manager.user.phoneNumber || undefined,
        propertyName: lease.property.name,
        amountPaid:   amountGHS,
        reference,
        paidAt,
      });
    } catch (err) {
      console.error("[PAYSTACK] ❌ Notification error:", err);
    }
  }
};

// ── charge.failed ──────────────────────────────────────────
const handleChargeFailed = async (data: any): Promise<void> => {
  const reference = data.reference  as string;
  const amountGHS = ((data.amount as number) || 0) / 100;
  const metadata  = data.metadata   || {};
  const leaseId   = Number(metadata.leaseId);

  console.log(`[PAYSTACK] ❌ charge.failed — ref: ${reference}`);

  await prisma.transaction.updateMany({
    where: { paystackReference: reference },
    data:  { status: "Failed" },
  });

  await logSystemEvent({
    action:  "PAYMENT_FAILED",
    target:  `Ref: ${reference}`,
    details: "charge.failed event received from Paystack",
  });

  try {
    const lease = await prisma.lease.findUnique({
      where:   { id: leaseId },
      include: {
        tenant:   { include: { user: true } },
        property: true,
      },
    });

    if (lease) {
      await notifyPaymentFailed({
        tenantName:   lease.tenant.user.name,
        tenantEmail:  lease.tenant.user.email,
        tenantPhone:  lease.tenant.user.phoneNumber || (lease.tenant as any).phoneNumber || undefined,
        propertyName: lease.property.name,
        amountDue:    amountGHS,
        reference,
      });
    }
  } catch (err) {
    console.error("[PAYSTACK] ❌ Failure notification error:", err);
  }
};