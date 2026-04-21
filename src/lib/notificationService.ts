import { sendSMS } from "./sms";
import {
  sendPaymentConfirmationEmail,
  sendPaymentFailedEmail,
  sendManagerPaymentReceivedEmail,
} from "./email";

// ─────────────────────────────────────────────────────────────────────────────
//  notificationService.ts
//
//  Central notification hub for all payment-related events.
//  Sends both SMS and email notifications where appropriate.
//
//  DESIGN RULES:
//
//  1. Never throw — every notification catches its own error.
//     A failed SMS or email must never crash a confirmed payment.
//
//  2. Always parallel — all SMS + email tasks fire at the same time
//     using Promise.allSettled. Paystack expects a fast webhook response.
//     Sequential awaits add 300ms per notification and trigger Paystack retries.
//
//  3. Always log full error — never err.message alone.
//     err.message is undefined when the rejection is a string, a network
//     object, or anything that is not a native Error. Log err directly.
//
//  4. Phone numbers are optional — guard before sending, not after crashing.
//     Not every tenant or manager has a phone number on file.
// ─────────────────────────────────────────────────────────────────────────────

// ── INTERNAL FORMAT HELPER ────────────────────────────────────────────────────
// Single place for GH₵ formatting so it never drifts between functions.

const formatAmount = (amount: number): string =>
  `GH₵ ${amount.toLocaleString("en-GH", { minimumFractionDigits: 2 })}`;

// ── PAYMENT SUCCESS ───────────────────────────────────────────────────────────

/**
 * Notify both tenant and manager after a successful payment.
 *
 * Fires in parallel:
 *   - SMS to tenant (if phone on file)
 *   - SMS to manager (if phone on file)
 *   - Confirmation email to tenant
 *   - Receipt email to manager (with commission breakdown)
 *
 * Called by: webhookControllers.ts after charge.success confirmed
 */
export const notifyPaymentSuccess = async (params: {
  tenantName:    string;
  tenantEmail:   string;
  tenantPhone?:  string;
  managerName:   string;
  managerEmail:  string;
  managerPhone?: string;
  propertyName:  string;
  amountPaid:    number;
  reference:     string;
  paidAt:        Date;
}): Promise<void> => {
  const amount = formatAmount(params.amountPaid);

  const tasks: Promise<unknown>[] = [];

  // ── SMS to tenant ──
  if (params.tenantPhone) {
    tasks.push(
      sendSMS(
        params.tenantPhone,
        `AskDerek: Payment of ${amount} for ${params.propertyName} confirmed. Ref: ${params.reference}. Thank you! 🇬🇭`
      ).catch((err) => console.error("[NOTIFICATION] Tenant SMS error:", err))
    );
  }

  // ── SMS to manager ──
  if (params.managerPhone) {
    tasks.push(
      sendSMS(
        params.managerPhone,
        `AskDerek: ${params.tenantName} paid ${amount} for ${params.propertyName}. Ref: ${params.reference} 🇬🇭`
      ).catch((err) => console.error("[NOTIFICATION] Manager SMS error:", err))
    );
  }

  // ── Confirmation email to tenant ──
  tasks.push(
    sendPaymentConfirmationEmail(
      params.tenantEmail,
      params.tenantName,
      params.propertyName,
      params.amountPaid,
      params.reference,
      params.paidAt
    ).catch((err) => console.error("[NOTIFICATION] Tenant email error:", err))
  );

  // ── Receipt email to manager (commission breakdown) ──
  tasks.push(
    sendManagerPaymentReceivedEmail(
      params.managerEmail,
      params.managerName,
      params.tenantName,
      params.propertyName,
      params.amountPaid,
      params.reference,
      params.paidAt
    ).catch((err) => console.error("[NOTIFICATION] Manager email error:", err))
  );

  await Promise.allSettled(tasks);
};

// ── PAYMENT FAILED ────────────────────────────────────────────────────────────

/**
 * Notify the tenant their payment failed.
 * Always includes what to do next — no blank failure screen.
 *
 * Called by: webhookControllers.ts after charge.failed received
 */
export const notifyPaymentFailed = async (params: {
  tenantName:   string;
  tenantEmail:  string;
  tenantPhone?: string;
  propertyName: string;
  amountDue:    number;
  reference:    string;
}): Promise<void> => {
  const amount = formatAmount(params.amountDue);

  const tasks: Promise<unknown>[] = [];

  // ── SMS to tenant ──
  if (params.tenantPhone) {
    tasks.push(
      sendSMS(
        params.tenantPhone,
        `AskDerek: Your payment of ${amount} for ${params.propertyName} failed. Ref: ${params.reference}. Please try again at askderek.com 🇬🇭`
      ).catch((err) => console.error("[NOTIFICATION] Failed payment SMS error:", err))
    );
  }

  // ── Email to tenant ──
  tasks.push(
    sendPaymentFailedEmail(
      params.tenantEmail,
      params.tenantName,
      params.propertyName,
      params.amountDue,
      params.reference
    ).catch((err) => console.error("[NOTIFICATION] Failed payment email error:", err))
  );

  await Promise.allSettled(tasks);
};

// ── CASH PAYMENT RECORDED ─────────────────────────────────────────────────────

/**
 * Notify the tenant when a manager records a manual cash payment on their behalf.
 * SMS only — the tenant needs to know it was logged and keep their physical receipt.
 *
 * Called by: adminPaymentControllers.ts
 */
export const notifyCashPaymentRecorded = async (params: {
  tenantName:    string;
  tenantEmail:   string;
  tenantPhone?:  string;
  propertyName:  string;
  amountPaid:    number;
  reference:     string;
  recordedBy:    string;
}): Promise<void> => {
  const amount = formatAmount(params.amountPaid);

  const tasks: Promise<unknown>[] = [];

  // ── SMS to tenant ──
  if (params.tenantPhone) {
    tasks.push(
      sendSMS(
        params.tenantPhone,
        `AskDerek: Cash payment of ${amount} for ${params.propertyName} recorded by ${params.recordedBy}. Ref: ${params.reference}. Keep your physical receipt. 🇬🇭`
      ).catch((err) => console.error("[NOTIFICATION] Cash payment SMS error:", err))
    );
  }

  // ── Confirmation email to tenant ──
  tasks.push(
    sendPaymentConfirmationEmail(
      params.tenantEmail,
      params.tenantName,
      params.propertyName,
      params.amountPaid,
      params.reference,
      new Date()
    ).catch((err) => console.error("[NOTIFICATION] Cash payment email error:", err))
  );

  await Promise.allSettled(tasks);
};

// ── PAYMENT EXPIRED ───────────────────────────────────────

/**
 * Notify the tenant their payment session expired.
 * SMS only — quick and direct.
 * Called by: paymentExpiryJob.ts
 */
export const notifyTenantPaymentExpired = async (params: {
  tenantName:      string;
  tenantPhone?:    string;
  propertyAddress: string;
  amountDue:       number;
}): Promise<void> => {
  const amount = formatAmount(params.amountDue);

  if (params.tenantPhone) {
    await sendSMS(
      params.tenantPhone,
      `AskDerek: Your payment session of ${amount} for ${params.propertyAddress} has expired. Please login at askderek.com to try again. 🇬🇭`
    ).catch((err) => console.error("[NOTIFICATION] Expired payment SMS error:", err));
  }
};