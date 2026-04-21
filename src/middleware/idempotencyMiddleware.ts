import { Request, Response, NextFunction } from "express";

/**
 * idempotencyMiddleware
 *
 * Prevents duplicate payment processing caused by:
 * - Network retries from the client
 * - Double-clicks on the pay button
 * - Paystack webhook retries
 *
 * How it works:
 * - Client sends an Idempotency-Key header with every payment request
 * - Server stores processed keys in memory (upgrade to Redis in production)
 * - If the same key is seen again within the TTL window, return 409 Conflict
 *
 * PRODUCTION NOTE: Replace the in-memory store with Redis for multi-instance
 * deployments. In-memory does not survive server restarts or scale across pods.
 */

// ── IN-MEMORY IDEMPOTENCY STORE ────────────────────────────
// key → timestamp of first processing
const processedKeys = new Map<string, number>();

// ── TTL: 24 hours in milliseconds ─────────────────────────
const KEY_TTL_MS = 24 * 60 * 60 * 1000;

// ── CLEANUP: purge expired keys every hour ─────────────────
setInterval(() => {
  const now = Date.now();
  for (const [key, timestamp] of processedKeys.entries()) {
    if (now - timestamp > KEY_TTL_MS) {
      processedKeys.delete(key);
    }
  }
}, 60 * 60 * 1000);

// ── MIDDLEWARE ─────────────────────────────────────────────
export const idempotencyMiddleware = (
  req:  Request,
  res:  Response,
  next: NextFunction
): void => {
  // Only apply to POST requests — GET requests are naturally idempotent
  if (req.method !== "POST") {
    next();
    return;
  }

  const idempotencyKey = req.headers["idempotency-key"] as string | undefined;

  // If no key provided, allow through — key is optional for non-critical POST routes
  if (!idempotencyKey) {
    next();
    return;
  }

  const now = Date.now();

  if (processedKeys.has(idempotencyKey)) {
    const timestamp = processedKeys.get(idempotencyKey)!;

    // ── Key still within TTL — reject as duplicate ──
    if (now - timestamp < KEY_TTL_MS) {
      res.status(409).json({
        error:   "Duplicate request",
        message: "This request has already been processed. Check your payment status.",
        code:    "IDEMPOTENCY_CONFLICT",
      });
      return;
    }

    // ── Key expired — allow through and refresh ──
    processedKeys.delete(idempotencyKey);
  }

  // ── Record this key ──
  processedKeys.set(idempotencyKey, now);
  next();
};