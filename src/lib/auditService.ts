import { prisma } from "./prisma";

// ─────────────────────────────────────────────────────────────────────────────
//  auditService.ts
//
//  Permanent, immutable audit trail for every payment action on AskDerek.
//
//  WHY THIS FILE EXISTS:
//  When a tenant says "I paid" and the landlord says "I never received" —
//  this audit trail settles the dispute in seconds with a timestamped,
//  tamper-proof record of every status change, webhook event, and admin action.
//
//  CRITICAL DESIGN RULE — never throw, never block:
//  A failed audit log must NEVER stop a payment from completing.
//  If the database is temporarily unavailable, the payment goes through
//  and the failure is logged to console for investigation.
// ─────────────────────────────────────────────────────────────────────────────

// ── ACTION TYPE ───────────────────────────────────────────────────────────────

export type AuditAction =
  | "PAYMENT_INITIALIZED"
  | "PAYMENT_PENDING"
  | "PAYMENT_SUCCESS"
  | "PAYMENT_FAILED"
  | "PAYMENT_EXPIRED"
  | "PAYMENT_RETRY"
  | "WEBHOOK_RECEIVED"
  | "WEBHOOK_VERIFIED"
  | "WEBHOOK_REJECTED"
  | "COMMISSION_RECORDED"
  | "RECEIPT_GENERATED"
  | "ADMIN_OVERRIDE"
  | "CASH_PAYMENT_RECORDED"
  | "REMINDER_SENT"
  | "OVERDUE_MARKED";

// ── INTERFACES ────────────────────────────────────────────────────────────────

interface LogPaymentActionArgs {
  paymentId:       number;
  action:          AuditAction;
  previousStatus?: string;
  newStatus?:      string;
  performedBy:     string;
  ipAddress?:      string;
  notes?:          string;
}

// ── LOG A SINGLE PAYMENT ACTION ───────────────────────────────────────────────

export const logPaymentAction = async (
  args: LogPaymentActionArgs
): Promise<void> => {
  try {
    await prisma.paymentLog.create({
      data: {
        paymentId:      args.paymentId,
        action:         args.action,
        previousStatus: args.previousStatus ?? null,
        newStatus:      args.newStatus       ?? null,
        performedBy:    args.performedBy,
        ipAddress:      args.ipAddress       ?? null,
        notes:          args.notes           ?? null,
      },
    });
  } catch (err) {
    console.error(
      `[AUDIT] ❌ Failed to log action "${args.action}" for payment ${args.paymentId}:`,
      err
    );
  }
};

// ── LOG A WEBHOOK EVENT ───────────────────────────────────────────────────────

export const logWebhookEvent = async (opts: {
  paymentId?:  number;
  event:       string;
  reference:   string;
  verified:    boolean;
  rawPayload:  Record<string, unknown>;
}): Promise<void> => {
  try {
    await prisma.transaction.create({
      data: {
        event:       opts.event,
        triggeredBy: "system",
        metadata:    JSON.stringify({
          reference:  opts.reference,
          verified:   opts.verified,
          payload:    opts.rawPayload,
          receivedAt: new Date().toISOString(),
        }),
      },
    });
  } catch (err) {
    console.error(
      `[AUDIT] ❌ Failed to log webhook event "${opts.event}" ref ${opts.reference}:`,
      err
    );
  }
};

// ── LOG A COMMISSION RECORD ───────────────────────────────────────────────────

export const logCommission = async (opts: {
  transactionId:    string;
  managerClerkId:   string;
  grossAmount:      number;
  commissionRate:   number;
  commissionAmount: number;
  netAmount:        number;
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

// ── GET FULL AUDIT TRAIL FOR A PAYMENT ───────────────────────────────────────

export const getPaymentAuditTrail = async (
  paymentId: number
): Promise<object[]> => {
  return prisma.paymentLog.findMany({
    where:   { paymentId },
    orderBy: { createdAt: "asc" },
  });
};

// ── SYSTEM EVENT LOG ──────────────────────────────────────────────────────────

export const logSystemEvent = async (opts: {
  action:   string;
  target:   string;
  details?: string;
}): Promise<void> => {
  try {
    await prisma.auditLog.create({
      data: {
        adminId: 1,
        action:  opts.action,
        target:  opts.target,
        details: opts.details ?? null,
      },
    });
  } catch (err) {
    console.error(
      `[AUDIT] ❌ Failed to log system event "${opts.action}":`,
      err
    );
  }
};