import { sendSMS } from "./sms";
import { formatGHS, formatDateShort } from "./paymentUtils";

// ─────────────────────────────────────────────────────────────────────────────
//  reminderService.ts
//
//  Sends rent reminder SMS messages to tenants and landlords via Arkesel.
//  Called by reminderJob.ts (runs at 08:00 daily) and overduePaymentJob.ts.
//
//  CRITICAL DESIGN RULE — never throw:
//  The reminder job loops through hundreds of tenants in one run.
//  If one SMS fails and throws, every tenant after that point in the loop
//  gets no reminder that day — a silent mass failure.
//  Every function here catches its own errors, logs them, and returns cleanly
//  so the calling job always continues to the next tenant.
//
//  Messages are written in plain, clear English that works for all Ghana
//  users regardless of education level. No jargon. No abbreviations.
// ─────────────────────────────────────────────────────────────────────────────

export interface ReminderPayload {
  tenantName:      string;
  tenantPhone:     string;
  propertyAddress: string;
  amountDue:       number;
  dueDate:         Date;
  leaseId:         number;
  daysUntilDue:    number;
}

// ── INTERNAL SAFE SENDER ──────────────────────────────────────────────────────
//
// Single place where SMS errors are caught and logged.
// All exported functions go through this — no duplicated try/catch blocks.
// Returns true if sent, false if failed — callers can log metrics if needed.

const safeSend = async (
  phone:   string,
  message: string,
  label:   string
): Promise<boolean> => {
  try {
    await sendSMS(phone, message);
    console.log(`[REMINDER] ✅ ${label} → ${phone}`);
    return true;
  } catch (err) {
    console.error(`[REMINDER] ❌ Failed: ${label} → ${phone}`, err);
    return false;
  }
};

// ── 7 DAYS BEFORE DUE DATE ────────────────────────────────────────────────────

/**
 * Send an early reminder 7 days before rent is due.
 * Goal: give the tenant maximum time to prepare.
 */
export const sendSevenDayReminder = async (
  payload: ReminderPayload
): Promise<void> => {
  const message =
    `AskDerek: Hi ${payload.tenantName}, your rent of ` +
    `${formatGHS(payload.amountDue)} for ${payload.propertyAddress} ` +
    `is due on ${formatDateShort(payload.dueDate)}. ` +
    `That is 7 days from now. Pay early to avoid any issues. ` +
    `Login at askderek.com to pay.`;

  await safeSend(payload.tenantPhone, message, "7-day reminder");
};

// ── 3 DAYS BEFORE DUE DATE ────────────────────────────────────────────────────

/**
 * Send an urgent reminder 3 days before rent is due.
 * Goal: create urgency without panic.
 */
export const sendThreeDayReminder = async (
  payload: ReminderPayload
): Promise<void> => {
  const message =
    `AskDerek: Hi ${payload.tenantName}, your rent of ` +
    `${formatGHS(payload.amountDue)} for ${payload.propertyAddress} ` +
    `is due in 3 days on ${formatDateShort(payload.dueDate)}. ` +
    `Please pay now to avoid being marked overdue. ` +
    `Login at askderek.com to pay.`;

  await safeSend(payload.tenantPhone, message, "3-day reminder");
};

// ── DUE TODAY ─────────────────────────────────────────────────────────────────

/**
 * Send a same-day reminder on the rent due date.
 * Goal: clear, direct, no room for confusion.
 */
export const sendDueTodayReminder = async (
  payload: ReminderPayload
): Promise<void> => {
  const message =
    `AskDerek: Hi ${payload.tenantName}, your rent of ` +
    `${formatGHS(payload.amountDue)} for ${payload.propertyAddress} ` +
    `is DUE TODAY. Please pay now to avoid being marked overdue. ` +
    `Login at askderek.com to pay immediately.`;

  await safeSend(payload.tenantPhone, message, "due today reminder");
};

// ── 1 DAY OVERDUE ─────────────────────────────────────────────────────────────

/**
 * Send a warning the day after the due date passes unpaid.
 * Goal: prompt immediate action while keeping a respectful tone.
 */
export const sendOneDayOverdueWarning = async (
  payload: ReminderPayload
): Promise<void> => {
  const message =
    `AskDerek: Hi ${payload.tenantName}, your rent of ` +
    `${formatGHS(payload.amountDue)} for ${payload.propertyAddress} ` +
    `was due yesterday and is now OVERDUE. ` +
    `Please pay immediately. Contact your landlord if you need help. ` +
    `Login at askderek.com.`;

  await safeSend(payload.tenantPhone, message, "1-day overdue warning");
};

// ── 3 DAYS OVERDUE — FINAL WARNING ───────────────────────────────────────────

/**
 * Send a final warning 3 days after the due date.
 * Goal: communicate seriousness without being threatening.
 * After this point the landlord is alerted and the account is escalated.
 */
export const sendFinalOverdueWarning = async (
  payload: ReminderPayload
): Promise<void> => {
  const message =
    `AskDerek URGENT: Hi ${payload.tenantName}, your rent of ` +
    `${formatGHS(payload.amountDue)} for ${payload.propertyAddress} ` +
    `is 3 days overdue. This is your final reminder. ` +
    `Please pay immediately or contact your landlord directly. ` +
    `Login at askderek.com.`;

  await safeSend(payload.tenantPhone, message, "final overdue warning");
};

// ── LANDLORD OVERDUE ALERT ────────────────────────────────────────────────────

/**
 * Alert the landlord when a tenant becomes overdue.
 * Sent by overduePaymentJob.ts when a lease is first marked OVERDUE.
 * Gives the landlord full context — tenant name, property, amount, days.
 */
export const sendLandlordOverdueAlert = async (
  landlordPhone:   string,
  landlordName:    string,
  tenantName:      string,
  propertyAddress: string,
  amountDue:       number,
  daysOverdue:     number
): Promise<void> => {
  const dayWord = daysOverdue === 1 ? "day" : "days";

  const message =
    `AskDerek: Hi ${landlordName}, your tenant ${tenantName} ` +
    `at ${propertyAddress} has not paid rent of ${formatGHS(amountDue)}. ` +
    `They are ${daysOverdue} ${dayWord} overdue. ` +
    `Login at askderek.com to view full details and take action.`;

  await safeSend(landlordPhone, message, "landlord overdue alert");
};