import { prisma } from "./prisma";

// ─────────────────────────────────────────────────────────────────────────────
//  auditService.ts
//
//  This is AskDerek's court-level evidence system.
//  Every important action on the platform is recorded here permanently.
//
//  Think of it like a bank's transaction ledger —
//  every move is logged, who did it, when, and why.
//  Even if someone tries to dispute a payment or deletion,
//  this file has the permanent proof.
//
//  Three types of actors can perform actions:
//    system — automated cron jobs (midnight overdue check, 2am reconciliation)
//    admin  — Derek taking a manual action on the platform
//    user   — a tenant or landlord doing something on their account
// ─────────────────────────────────────────────────────────────────────────────

// ── AUDIT ACTION TYPES ────────────────────────────────────────────────────────
// This union type enforces that only valid action strings are ever logged.
// TypeScript will catch any typo at compile time — not at runtime.
// Add new actions here as the platform grows.
export type AuditAction =
  // ── Payment lifecycle ──
  | "PAYMENT_INITIALIZED"     // tenant clicked Pay Rent
  | "PAYMENT_PENDING"         // waiting for Paystack confirmation
  | "PAYMENT_SUCCESS"         // payment confirmed by Paystack webhook
  | "PAYMENT_FAILED"          // payment failed or was abandoned
  | "PAYMENT_EXPIRED"         // payment session timed out after 30 minutes
  | "PAYMENT_RETRY"           // tenant retried a failed payment
  // ── Webhook events ──
  | "WEBHOOK_RECEIVED"        // Paystack webhook arrived at server
  | "WEBHOOK_VERIFIED"        // HMAC-SHA512 signature confirmed genuine
  | "WEBHOOK_REJECTED"        // signature check failed — possible fake webhook
  // ── Financial records ──
  | "COMMISSION_RECORDED"     // 5% AskDerek commission split and saved
  | "RECEIPT_GENERATED"       // digital receipt created for tenant
  | "CASH_PAYMENT_RECORDED"   // admin recorded an offline cash payment
  // ── Admin actions ──
  | "ADMIN_OVERRIDE"          // Derek manually changed a payment status
  | "OVERDUE_MARKED"          // midnight job marked a payment as overdue
  | "REMINDER_SENT"           // SMS reminder fired to tenant
  // ── Property actions (Phase 3.5) ──
  | "PROPERTY_ARCHIVED"       // manager hid property from search
  | "PROPERTY_PENDING_REMOVAL"// admin triggered 10-minute removal window
  | "PROPERTY_SOFT_DELETED"   // property removed from platform — data preserved
  | "PROPERTY_RESTORED"       // soft-deleted property brought back
  | "PROPERTY_SOLD"           // property marked as sold
  | "PROPERTY_RENTED"         // property marked as rented
  // ── Lease events (Phase 3.5) ──
  | "LEASE_FROZEN"            // lease frozen because property was removed
  | "LEASE_UNFROZEN"          // lease reinstated after property restored
  | "LEASE_EXPIRED"           // lease end date passed
  | "LEASE_RENEWED"           // tenant renewed their lease
  // ── Enquiry events (Phase 3.5) ──
  | "ENQUIRY_CREATED"         // buyer expressed interest in property
  | "DEAL_RECORDED"           // negotiated price agreed and recorded
  | "DEAL_COMPLETED"          // sale fully completed — commission due
  // ── Message events (Phase 3.5) ──
  | "MESSAGE_REDACTED"        // admin removed sensitive content from message
  | "MESSAGE_FLAGGED"         // message flagged for admin review
  // ── System events ──
  | "SYSTEM_EVENT";           // generic system action not covered above

// ─────────────────────────────────────────────────────────────────────────────
//  INTERFACES
// ─────────────────────────────────────────────────────────────────────────────

// Arguments needed to log a payment-specific action.
// Payment logs are more detailed than system logs
// because they are the primary financial evidence trail.
interface LogPaymentActionArgs {
  paymentId:       number;
  action:          AuditAction;
  previousStatus?: string;      // what the status was before
  newStatus?:      string;      // what the status changed to
  performedBy:     "system" | "admin" | "user";
  adminId?:        number;      // only set when an admin did the action
  ipAddress?:      string;      // useful for detecting fraud patterns
  notes?:          string;      // any extra context
}

// ─────────────────────────────────────────────────────────────────────────────
//  LOG PAYMENT ACTION
//
//  Records a payment-specific event in the PaymentLog table.
//  This is called on every stage of the payment lifecycle —
//  from initialization to success, failure, or expiry.
//  Each PaymentLog entry is linked to a specific payment record.
// ─────────────────────────────────────────────────────────────────────────────
export const logPaymentAction = async (
  args: LogPaymentActionArgs
): Promise<void> => {
  try {
    await prisma.paymentLog.create({
      data: {
        paymentId:      args.paymentId,
        action:         args.action,
        previousStatus: args.previousStatus ?? null,
        newStatus:      args.newStatus      ?? null,

        // Who performed this — system, admin, or user
        performedBy:    args.performedBy,

        // IP address helps identify fraud patterns later
        ipAddress:      args.ipAddress ?? null,

        notes:          args.notes ?? null,
      },
    });
  } catch (err) {
    // We log the error but never crash the main payment flow.
    // A failed audit log should never stop a payment from processing.
    console.error(
      `[AUDIT] ❌ Failed to log payment action "${args.action}":`,
      err
    );
  }
};

// ─────────────────────────────────────────────────────────────────────────────
//  LOG WEBHOOK EVENT
//
//  Records every incoming Paystack webhook as a Transaction record.
//  This gives Derek a full history of every webhook that arrived —
//  verified ones, rejected ones, and duplicates.
//
//  Real life example: If Paystack sends the same webhook twice
//  (which happens sometimes), both arrivals are logged here.
//  The idempotency middleware blocks the duplicate from processing,
//  but the audit trail shows both arrived.
// ─────────────────────────────────────────────────────────────────────────────
export const logWebhookEvent = async (opts: {
  paymentId?:  number;
  event:       string;               // e.g. "charge.success"
  reference:   string;               // Paystack transaction reference
  verified:    boolean;              // did HMAC-SHA512 check pass?
  rawPayload:  Record<string, unknown>; // the full webhook body
}): Promise<void> => {
  try {
    await prisma.transaction.create({
      data: {
        // "system" because webhooks arrive from Paystack — not a human
        triggeredBy: "system",
        event:       opts.event,

        // Store the full payload as JSON for future investigation.
        // If a dispute ever happens, Derek can see exactly what
        // Paystack sent down to the millisecond.
        metadata: JSON.stringify({
          reference:  opts.reference,
          verified:   opts.verified,
          payload:    opts.rawPayload,
          receivedAt: new Date().toISOString(),
        }),
      },
    });
  } catch (err) {
    console.error(
      `[AUDIT] ❌ Failed to log webhook event "${opts.event}":`,
      err
    );
  }
};

// ─────────────────────────────────────────────────────────────────────────────
//  LOG COMMISSION
//
//  Records the 5% AskDerek commission split for every successful payment.
//  This is Derek's revenue record — every GHS earned is logged here.
//
//  Example: Tenant pays GHS 700.
//  Derek earns GHS 35 (5%).
//  Landlord receives GHS 665 (95%).
//  This function records all three numbers permanently.
// ─────────────────────────────────────────────────────────────────────────────
export const logCommission = async (opts: {
  transactionId:    string;
  managerClerkId:   string;
  grossAmount:      number;    // what tenant paid — e.g. GHS 700
  commissionRate:   number;    // always 0.05 (5%)
  commissionAmount: number;    // Derek's share — e.g. GHS 35
  netAmount:        number;    // landlord's share — e.g. GHS 665
}): Promise<void> => {
  try {
    await prisma.commission.create({
      data: {
        transactionId:    opts.transactionId,
        managerClerkId:   opts.managerClerkId,
        grossAmount:      opts.grossAmount,
        commissionRate:   opts.commissionRate,
        commissionAmount: opts.commissionAmount,
        netAmount:        opts.netAmount,
      },
    });
  } catch (err) {
    console.error(
      `[AUDIT] ❌ Failed to log commission for transaction ${opts.transactionId}:`,
      err
    );
  }
};

// ─────────────────────────────────────────────────────────────────────────────
//  GET PAYMENT AUDIT TRAIL
//
//  Returns the complete history of every action taken on a payment.
//  Used by the admin panel and dispute resolution system.
//
//  Example: If a tenant disputes that their payment was not recorded,
//  Derek opens the audit trail and sees:
//    09:45:01 — PAYMENT_INITIALIZED — system
//    09:45:03 — PAYMENT_PENDING     — system
//    09:45:47 — WEBHOOK_RECEIVED    — system
//    09:45:47 — PAYMENT_SUCCESS     — system
//  Case closed. Payment happened. Evidence permanent.
// ─────────────────────────────────────────────────────────────────────────────
export const getPaymentAuditTrail = async (
  paymentId: number
): Promise<object[]> => {
  return prisma.paymentLog.findMany({
    where:   { paymentId },
    orderBy: { createdAt: "asc" }, // chronological order — oldest first
  });
};

// ─────────────────────────────────────────────────────────────────────────────
//  LOG SYSTEM EVENT
//
//  Records automated platform events — cron jobs, background tasks,
//  and any action performed by the system without a human involved.
//
//  Examples of system events:
//    - Midnight overdue job marking 5 payments as overdue
//    - 2am reconciliation finding and fixing a mismatch
//    - 8am reminder job sending SMS to 12 tenants
//    - Payment expiry job cancelling an abandoned session
//
//  adminId is null here because no human performed the action.
//  The AuditActor enum ensures this is typed correctly.
// ─────────────────────────────────────────────────────────────────────────────
export const logSystemEvent = async (opts: {
  action:   string;
  target:   string;
  details?: string;
}): Promise<void> => {
  try {
    await prisma.auditLog.create({
      data: {
        // system = automated action — no human involved
        // Using the AuditActor enum prevents typos like "System" or "SYSTEM"
        performedBy: "system",

        // No admin triggered this — cron jobs run without human input
        adminId:     null,

        action:      opts.action,
        target:      opts.target,
        details:     opts.details ?? null,
      },
    });
  } catch (err) {
    console.error(
      `[AUDIT] ❌ Failed to log system event "${opts.action}":`,
      err
    );
  }
};

// ─────────────────────────────────────────────────────────────────────────────
//  LOG ADMIN EVENT
//
//  Records actions that Derek (or a future admin staff member) takes manually.
//  Examples: overriding a payment status, recording a cash payment,
//  removing a fraudulent listing, or approving a landlord verification.
//
//  Unlike system events, admin events always have an adminId.
//  This creates accountability — Derek can always see who did what and when.
//  If AskDerek ever has multiple admin staff, this trace is critical.
// ─────────────────────────────────────────────────────────────────────────────
export const logAdminEvent = async (opts: {
  adminId:  number;    // the database ID of the admin user
  action:   string;
  target:   string;
  details?: string;
}): Promise<void> => {
  try {
    await prisma.auditLog.create({
      data: {
        // admin = Derek or authorized staff took this action manually
        performedBy: "admin",

        // adminId is required for admin events — creates accountability
        adminId:     opts.adminId,

        action:      opts.action,
        target:      opts.target,
        details:     opts.details ?? null,
      },
    });
  } catch (err) {
    console.error(
      `[AUDIT] ❌ Failed to log admin event "${opts.action}":`,
      err
    );
  }
};

// ─────────────────────────────────────────────────────────────────────────────
//  LOG USER EVENT
//
//  Records actions taken by tenants or landlords on their own accounts.
//  Examples: tenant submitting an application, landlord listing a property,
//  tenant requesting a refund, landlord marking a property as sold.
//
//  userClerkId links the action to the specific user who did it.
//  This is important for dispute resolution — if a landlord claims they
//  never listed a fake property, the user event log proves they did.
// ─────────────────────────────────────────────────────────────────────────────
export const logUserEvent = async (opts: {
  userClerkId: string;  // Clerk ID of the tenant or landlord
  action:      string;
  target:      string;
  details?:    string;
}): Promise<void> => {
  try {
    await prisma.auditLog.create({
      data: {
        // user = a tenant or landlord took this action themselves
        performedBy: "user",

        // No adminId for user events — they are not admin actions
        adminId:     null,

        action:      opts.action,
        target:      opts.target,

        // Store the userClerkId in details so we know exactly who
        // performed this action — links back to their Clerk profile
        details:     opts.details
          ? `${opts.details} | userClerkId: ${opts.userClerkId}`
          : `userClerkId: ${opts.userClerkId}`,
      },
    });
  } catch (err) {
    console.error(
      `[AUDIT] ❌ Failed to log user event "${opts.action}":`,
      err
    );
  }
};