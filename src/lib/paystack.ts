import axios, { AxiosError } from "axios";

// ── ENV CONFIG ─────────────────────────────────────────────
const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY;
const CLIENT_URL          = process.env.CLIENT_URL || "http://localhost:3000";

if (!PAYSTACK_SECRET_KEY) {
  console.error("[PAYSTACK] ❌ PAYSTACK_SECRET_KEY is missing from environment variables.");
}

// ── PAYSTACK HEADERS ───────────────────────────────────────
const paystackHeaders = {
  Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
  "Content-Type": "application/json",
};

// ── TYPES ──────────────────────────────────────────────────
export interface PaystackInitializeParams {
  email:     string;
  amount:    number; // in GHS — will be converted to pesewas
  reference: string;
  metadata:  Record<string, unknown>;
}

export interface PaystackInitializeResult {
  authorization_url: string;
  access_code:       string;
  reference:         string;
}

export interface PaystackVerifyResult {
  status:    string; // "success" | "failed" | "abandoned"
  reference: string;
  amount:    number; // in pesewas
  channel:   string; // "card" | "mobile_money" etc
  paidAt:    string;
  metadata:  Record<string, unknown>;
  customer: {
    email: string;
    name:  string;
  };
}

// ── INITIALIZE TRANSACTION ─────────────────────────────────
export const paystackInitialize = async (
  params: PaystackInitializeParams
): Promise<PaystackInitializeResult> => {
  try {
    const response = await axios.post(
      "https://api.paystack.co/transaction/initialize",
      {
        email:        params.email,
        amount:       Math.round(params.amount * 100), // convert GHS to pesewas
        currency:     "GHS",
        reference:    params.reference,
        callback_url: `${CLIENT_URL}/payment/verify`,
        metadata:     params.metadata,
      },
      { headers: paystackHeaders }
    );

    return response.data.data as PaystackInitializeResult;
  } catch (err: unknown) {
    if (err instanceof AxiosError) {
      throw new Error(
        err.response?.data?.message || "Failed to initialize Paystack transaction"
      );
    }
    throw err;
  }
};

// ── VERIFY TRANSACTION ─────────────────────────────────────
export const paystackVerify = async (
  reference: string
): Promise<PaystackVerifyResult> => {
  try {
    const response = await axios.get(
      `https://api.paystack.co/transaction/verify/${reference}`,
      { headers: paystackHeaders }
    );

    return response.data.data as PaystackVerifyResult;
  } catch (err: unknown) {
    if (err instanceof AxiosError) {
      throw new Error(
        err.response?.data?.message || "Failed to verify Paystack transaction"
      );
    }
    throw err;
  }
};

// ── GENERATE UNIQUE REFERENCE ──────────────────────────────
export const generateReference = (leaseId: number): string => {
  return `ASKDEREK_LEASE_${leaseId}_${Date.now()}`;
};