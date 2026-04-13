import axios, { AxiosError } from "axios";
import { randomInt, createHash } from "crypto";

// ── ENV CONFIG ─────────────────────────────────────────────
const ARKESEL_API_KEY   = process.env.ARKESEL_API_KEY;
const ARKESEL_SENDER_ID = process.env.ARKESEL_SENDER_ID || "AskDerek";

// ── STRUCTURED LOGGER ──────────────────────────────────────
type LogLevel = "info" | "warn" | "error";

const log = (level: LogLevel, message: string, data?: unknown): void => {
  const timestamp = new Date().toISOString();
  const prefix    = `[SMS SERVICE] [${timestamp}]`;
  if (data !== undefined) {
    console[level](`${prefix} ${message}`, data);
  } else {
    console[level](`${prefix} ${message}`);
  }
};

// ── PHONE NUMBER SANITIZER ─────────────────────────────────
/**
 * Normalises a Ghanaian phone number to E.164 international format.
 * Accepts:  0241234567  |  +233241234567  |  233241234567  |  241234567
 * Returns:  +233241234567  or throws on invalid input.
 *
 * Exported so controllers can normalise before DB lookups without
 * duplicating this logic.
 */
export const normalisePhone = (raw: string): string => {
  const digits = raw.replace(/\D/g, ""); // strip everything except digits

  if (digits.startsWith("233") && digits.length === 12) {
    return `+${digits}`;
  }

  if (digits.startsWith("0") && digits.length === 10) {
    return `+233${digits.slice(1)}`;
  }

  if (digits.length === 9) {
    return `+233${digits}`;
  }

  throw new Error(
    `Invalid phone number format: "${raw}". ` +
    `Expected a Ghanaian number e.g. 0241234567 or +233241234567.`
  );
};

// ── OTP HASHER ─────────────────────────────────────────────
/**
 * Hashes an OTP with SHA-256 before storing.
 * If your DB leaks, attackers get hashes — not working OTP codes.
 *
 * Exported so the controller can hash before DB writes/comparisons
 * without reimplementing the algorithm.
 */
export const hashOTP = (otp: string): string =>
  createHash("sha256").update(otp).digest("hex");

// ── ARKESEL RESPONSE TYPE ──────────────────────────────────
interface ArkeselResponse {
  code:     string;
  message?: string;
  balance?: number;
  user?:    string;
}

// ── OTP RECORD TYPE ────────────────────────────────────────
/**
 * Returned by sendOTP for the caller to persist (DB / Redis / cache).
 * NOTE: the `otp` field is a SHA-256 HASH — never the raw code.
 */
export interface OTPRecord {
  phone:     string;  // normalised E.164 (+233XXXXXXXXX)
  otp:       string;  // SHA-256 hash of the 6-digit code
  expiresAt: number;  // Unix ms — Date.now() + 10 min
  used:      boolean; // true after successful verification
}

// ── RETRY HELPER ───────────────────────────────────────────
const withRetry = async (
  fn:      () => Promise<boolean>,
  retries: number = 3,
  delayMs: number = 1000
): Promise<boolean> => {
  for (let attempt = 1; attempt <= retries; attempt++) {
    const success = await fn();
    if (success) return true;

    if (attempt < retries) {
      log("warn", `Attempt ${attempt}/${retries} failed. Retrying in ${delayMs}ms...`);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  return false;
};

// ── SEND SMS (SINGLE ATTEMPT) ──────────────────────────────
const sendSMSOnce = async (
  normalisedPhone: string,
  message:         string
): Promise<boolean> => {
  try {
    // Arkesel SMS API V1 (sms.arkesel.com/sms/api) requires GET with query params.
    // POST returns 405. V2 (api.arkesel.com) uses POST — but that is a different URL.
    const response = await axios.get<ArkeselResponse>(
      "https://sms.arkesel.com/sms/api",
      {
        params: {
          action:  "send-sms",
          api_key: ARKESEL_API_KEY,
          to:      normalisedPhone,
          from:    ARKESEL_SENDER_ID,
          sms:     message,
        },
        timeout: 5_000, // 5 s — fail fast so retries kick in quickly
      }
    );

    if (response.data?.code?.toLowerCase() === "ok") {
      log("info", `SMS sent successfully to ${normalisedPhone}`);
      return true;
    }

    log("error", `SMS delivery failed for ${normalisedPhone}`, response.data);
    return false;
  } catch (err: unknown) {
    if (err instanceof AxiosError) {
      log("error", `SMS HTTP error [${err.response?.status}]: ${err.message}`, err.response?.data);
    } else if (err instanceof Error) {
      log("error", `SMS unexpected error: ${err.message}`);
    } else {
      log("error", "SMS unknown error", err);
    }
    return false;
  }
};

// ── SEND SMS (PUBLIC — WITH RETRY) ─────────────────────────
export const sendSMS = async (
  phoneNumber: string,
  message:     string
): Promise<boolean> => {
  if (!ARKESEL_API_KEY) {
    log("error", "ARKESEL_API_KEY is missing in environment variables. SMS not sent.");
    return false;
  }

  if (!message || message.trim().length === 0) {
    log("error", "SMS message is empty. SMS not sent.");
    return false;
  }

  let normalisedPhone: string;
  try {
    normalisedPhone = normalisePhone(phoneNumber);
  } catch (err: unknown) {
    log("error", `Phone number error: ${err instanceof Error ? err.message : err}`);
    return false;
  }

  return withRetry(() => sendSMSOnce(normalisedPhone, message), 3, 1000);
};

// ── SECURE OTP GENERATOR ───────────────────────────────────
export const generateOTP = (): string => {
  return randomInt(100_000, 1_000_000).toString();
};

// ── SEND OTP FUNCTION ──────────────────────────────────────
/**
 * Sends an OTP SMS and returns an OTPRecord (with hashed OTP) for storage.
 * Returns null if validation fails or SMS could not be sent.
 *
 * Usage:
 *   const otp    = generateOTP();
 *   const record = await sendOTP(phone, otp);
 *   if (record) await db.otpRecords.save(record);
 */
export const sendOTP = async (
  phoneNumber: string,
  otp:         string
): Promise<OTPRecord | null> => {
  if (!/^\d{6}$/.test(otp)) {
    log("error", "OTP must be a 6-digit numeric string. SMS not sent.");
    return null;
  }

  let normalisedPhone: string;
  try {
    normalisedPhone = normalisePhone(phoneNumber);
  } catch (err: unknown) {
    log("error", `Phone number error: ${err instanceof Error ? err.message : err}`);
    return null;
  }

  const message = `AskDerek: Your verification code is ${otp}. Expires in 10 minutes. Do not share.`;

  const sent = await sendSMS(normalisedPhone, message);
  if (!sent) return null;

  return {
    phone:     normalisedPhone, // always E.164 (+233XXXXXXXXX)
    otp:       hashOTP(otp),    // SHA-256 hash — raw code never stored
    expiresAt: Date.now() + 10 * 60 * 1000,
    used:      false,
  };
};

// ── VERIFY OTP FUNCTION ────────────────────────────────────
/**
 * Verifies a user-supplied OTP against a stored OTPRecord.
 * Mutates record.used = true on success — caller must persist this back to DB.
 *
 * Usage:
 *   const record = await db.otpRecords.findByPhone(phone);
 *   const valid  = verifyOTP(record, userInputOtp);
 *   if (valid) await db.otpRecords.save(record); // save used=true
 */
export const verifyOTP = (
  record:   OTPRecord,
  inputOtp: string
): boolean => {
  if (record.used) {
    log("warn", `OTP already used for ${record.phone}`);
    return false;
  }

  if (Date.now() > record.expiresAt) {
    log("warn", `OTP expired for ${record.phone}`);
    return false;
  }

  if (record.otp !== hashOTP(inputOtp)) {
    log("warn", `Invalid OTP attempt for ${record.phone}`);
    return false;
  }

  record.used = true;
  log("info", `OTP verified successfully for ${record.phone}`);
  return true;
};