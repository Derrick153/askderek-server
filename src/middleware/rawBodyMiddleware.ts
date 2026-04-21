import { Request, Response, NextFunction } from "express";

/**
 * rawBodyMiddleware
 *
 * Captures the raw request body as a Buffer before express.json() parses it.
 * This is REQUIRED for Paystack webhook signature verification — Paystack signs
 * the raw body with HMAC-SHA512. If you parse it as JSON first, the signature
 * check will always fail because JSON.stringify(JSON.parse(body)) may not
 * produce the exact same byte sequence that was signed.
 *
 * Usage: apply this middleware ONLY to webhook routes, before express.json().
 *
 * Access the raw body in your controller via: req.rawBody
 */

// ── EXTEND EXPRESS REQUEST TYPE ────────────────────────────
declare global {
  namespace Express {
    interface Request {
      rawBody?: Buffer;
    }
  }
}

export const rawBodyMiddleware = (
  req:  Request,
  res:  Response,
  next: NextFunction
): void => {
  const chunks: Buffer[] = [];

  req.on("data", (chunk: Buffer) => {
    chunks.push(chunk);
  });

  req.on("end", () => {
    req.rawBody = Buffer.concat(chunks);

    // ── Also parse as JSON if Content-Type is application/json ──
    // This lets the webhook controller access both req.rawBody (for HMAC)
    // and req.body (for convenient field access) without double middleware.
    if (req.headers["content-type"]?.includes("application/json")) {
      try {
        req.body = JSON.parse(req.rawBody.toString("utf8"));
      } catch {
        // If parsing fails, leave req.body as-is — the controller will handle it
      }
    }

    next();
  });

  req.on("error", (err) => {
    console.error("[RAW BODY MIDDLEWARE] Stream error:", err.message);
    res.status(400).json({ error: "Failed to read request body" });
  });
};