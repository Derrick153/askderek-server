import crypto from "crypto";

// ─────────────────────────────────────────────────────────────────────────────
//  paymentUtils.ts
//
//  Pure helper functions used across all payment files.
//  No side effects. No database calls. No external API calls.
//  Every function is deterministic — same input always produces same output.
//
//  Used by: paymentControllers, webhookControllers, receiptControllers,
//           commissionControllers, all jobs, all services.
// ─────────────────────────────────────────────────────────────────────────────

// ── SAFE ENV PARSER ───────────────────────────────────────────────────────────
//
// parseInt("abc") returns NaN silently — not 30.
// Number.isFinite() catches NaN, Infinity, and undefined in one check.
// This function is called lazily (at runtime, not at import) so hot-reloading
// env vars in tests works correctly.

const getExpiryMinutes = (): number => {
  const raw    = Number(process.env.PAYMENT_EXPIRY_MINUTES);
  return Number.isFinite(raw) && raw > 0 ? raw : 30;
};

// ── REFERENCE GENERATION ──────────────────────────────────────────────────────

/**
 * Generate a unique Paystack payment reference.
 *
 * Format:  AD-{timestamp}-{6 random hex chars}
 * Example: AD-1748000000000-a3f9k2
 *
 * Why this format:
 *   - AD prefix identifies AskDerek in Paystack dashboard instantly
 *   - Timestamp makes it sortable and human-debuggable
 *   - Cryptographic random suffix prevents collisions even at high throughput
 *   - crypto.randomBytes is cryptographically secure — Math.random() is not
 */
export const generatePaymentReference = (): string => {
  const random = crypto.randomBytes(3).toString("hex");
  return `AD-${Date.now()}-${random}`;
};

/**
 * Generate a manual cash payment reference.
 *
 * Format:  CASH-{timestamp}-{6 random hex chars}
 * Example: CASH-1748000000000-b7d2e1
 *
 * Used when a landlord records an offline cash payment through the admin panel.
 */
export const generateCashReference = (): string => {
  const random = crypto.randomBytes(3).toString("hex");
  return `CASH-${Date.now()}-${random}`;
};

// ── AMOUNT CALCULATIONS ───────────────────────────────────────────────────────

/**
 * Split a total payment into commission and landlord earnings.
 *
 * @param amount     - Total payment in GHS (e.g. 600)
 * @param percentage - Commission percentage (e.g. 5)
 * @returns { commissionAmount, landlordAmount } both in GHS
 *
 * Example:
 *   calculateCommission(600, 5)
 *   → { commissionAmount: 30, landlordAmount: 570 }
 *
 * Why parseFloat + toFixed(2):
 *   JavaScript floating point: 600 * 0.05 = 29.999999999999996
 *   toFixed(2) rounds to 2 decimal places, parseFloat strips trailing zeros.
 */
export const calculateCommission = (
  amount: number,
  percentage: number
): { commissionAmount: number; landlordAmount: number } => {
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("Amount must be a positive finite number");
  }
  if (!Number.isFinite(percentage) || percentage < 0 || percentage > 100) {
    throw new Error("Commission percentage must be between 0 and 100");
  }

  const commissionAmount = parseFloat(((amount * percentage) / 100).toFixed(2));
  const landlordAmount   = parseFloat((amount - commissionAmount).toFixed(2));

  return { commissionAmount, landlordAmount };
};

/**
 * Convert GHS to Paystack pesewas (smallest currency unit).
 * Paystack requires all amounts in pesewas — never GHS.
 *
 * Example: ghsToPesewas(600) → 60000
 *
 * Math.round prevents floating point issues:
 *   600.1 * 100 = 60009.999999999999 without rounding
 */
export const ghsToPesewas = (amountGHS: number): number => {
  if (!Number.isFinite(amountGHS)) throw new Error("Invalid amount");
  return Math.round(amountGHS * 100);
};

/**
 * Convert Paystack pesewas back to GHS.
 * Use when reading amounts from Paystack webhook payloads.
 *
 * Example: pesewasToGhs(60000) → 600
 */
export const pesewasToGhs = (amountPesewas: number): number => {
  if (!Number.isFinite(amountPesewas)) throw new Error("Invalid amount");
  return parseFloat((amountPesewas / 100).toFixed(2));
};

// ── CURRENCY FORMATTING ───────────────────────────────────────────────────────

/**
 * Format a GHS amount as a human-readable string.
 * Uses Ghana locale for correct thousand separators.
 *
 * Example: formatGHS(1250.5) → "GHS 1,250.50"
 * Example: formatGHS(600)    → "GHS 600.00"
 */
export const formatGHS = (amount: number): string => {
  return `GHS ${amount.toLocaleString("en-GH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
};

// ── PAYMENT EXPIRY ────────────────────────────────────────────────────────────

/**
 * Check whether a payment has passed its expiry window.
 *
 * @param createdAt     - When the payment was initialized
 * @param expiryMinutes - Minutes until expiry (default: env var or 30)
 * @returns true if the payment has expired
 *
 * Example:
 *   isPaymentExpired(new Date("2024-01-01T12:00:00"), 30)
 *   → true if now is past 12:30
 */
export const isPaymentExpired = (
  createdAt: Date,
  expiryMinutes: number = getExpiryMinutes()
): boolean => {
  const expiresAt = createdAt.getTime() + expiryMinutes * 60 * 1000;
  return Date.now() > expiresAt;
};

/**
 * Calculate the exact datetime a payment expires.
 * Store this in the database so the expiry job can query with a simple
 * WHERE expiresAt < NOW() instead of calculating in application code.
 *
 * @param createdAt     - Payment creation time (default: now)
 * @param expiryMinutes - Minutes until expiry (default: env var or 30)
 */
export const calculateExpiryDate = (
  createdAt: Date = new Date(),
  expiryMinutes: number = getExpiryMinutes()
): Date => {
  return new Date(createdAt.getTime() + expiryMinutes * 60 * 1000);
};

// ── VALIDATION ────────────────────────────────────────────────────────────────

/**
 * Validate that a payment amount is within acceptable bounds.
 *
 * Minimum GHS 50  — prevents test payments and sub-economic transactions
 * Maximum GHS 50,000 — safety cap; single payments above this need admin approval
 *
 * Throws a descriptive error on failure — callers do not need to check booleans.
 */
export const validatePaymentAmount = (amount: unknown): void => {
  const n = Number(amount);
  if (!Number.isFinite(n))  throw new Error("Payment amount is required and must be a number");
  if (n < 50)               throw new Error("Minimum payment amount is GHS 50");
  if (n > 50_000)           throw new Error("Maximum payment amount is GHS 50,000");
};

/**
 * Validate a payment reference against the known formats.
 *
 * Accepted formats:
 *   AD-{13 digit timestamp}-{6 hex chars}    → Paystack payment
 *   CASH-{13 digit timestamp}-{6 hex chars}  → Manual cash payment
 *
 * Why regex over length check:
 *   length < 8 would accept "XXXXXXXX" — completely fake.
 *   The regex verifies the exact structure generated by this file.
 */
export const validateReference = (reference: unknown): void => {
  if (!reference || typeof reference !== "string") {
    throw new Error("Payment reference is required");
  }
  const valid = /^(AD|CASH)-\d{10,}-[a-f0-9]{6}$/i.test(reference);
  if (!valid) throw new Error("Invalid payment reference format");
};

// ── DATE HELPERS ──────────────────────────────────────────────────────────────

/**
 * Format a date as a short, readable string for SMS messages.
 * Written for Ghana locale — day first, then month name, then year.
 *
 * Example: new Date("2024-12-25") → "25 Dec 2024"
 */
export const formatDateShort = (date: Date): string => {
  return date.toLocaleDateString("en-GH", {
    day:   "numeric",
    month: "short",
    year:  "numeric",
  });
};

/**
 * Calculate the number of days between today and a due date.
 * Returns a negative number if the due date has already passed.
 *
 * Midnight-normalised so "today" always returns 0 regardless of time of day.
 *
 * Example: daysUntilDue(tomorrow)    →  1
 * Example: daysUntilDue(today)       →  0
 * Example: daysUntilDue(yesterday)   → -1
 */
export const daysUntilDue = (dueDate: Date): number => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const due = new Date(dueDate);
  due.setHours(0, 0, 0, 0);

  return Math.round((due.getTime() - today.getTime()) / 86_400_000);
};

// ── PAYSTACK SIGNATURE VERIFICATION ──────────────────────────────────────────

/**
 * Verify a Paystack webhook HMAC-SHA512 signature.
 *
 * Paystack signs the raw request body with your secret key using HMAC-SHA512.
 * This function recomputes the hash and compares it to the signature header.
 *
 * CRITICAL: rawBody must be the original Buffer from rawBodyMiddleware.
 * Never use JSON.stringify(req.body) — re-serialising changes byte order
 * and the hash will never match.
 *
 * @param rawBody   - Raw request body Buffer from rawBodyMiddleware
 * @param signature - Value of x-paystack-signature header
 * @param secretKey - Your Paystack secret key from .env
 * @returns true if signature is valid
 *
 * Example:
 *   verifyPaystackSignature(req.rawBody, req.headers["x-paystack-signature"], process.env.PAYSTACK_SECRET_KEY!)
 */
export const verifyPaystackSignature = (
  rawBody:   Buffer,
  signature: string,
  secretKey: string
): boolean => {
  if (!rawBody || !signature || !secretKey) return false;

  const hash = crypto
    .createHmac("sha512", secretKey)
    .update(rawBody)
    .digest("hex");

  // Use timingSafeEqual to prevent timing attacks.
  // A simple === comparison leaks information about how many characters match.
  // timingSafeEqual always takes the same time regardless of where strings differ.
  try {
    const hashBuffer = Buffer.from(hash,      "hex");
    const sigBuffer  = Buffer.from(signature, "hex");

    if (hashBuffer.length !== sigBuffer.length) return false;

    return crypto.timingSafeEqual(hashBuffer, sigBuffer);
  } catch {
    return false;
  }
};