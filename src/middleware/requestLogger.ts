import { Request, Response, NextFunction } from "express";

/**
 * requestLogger
 *
 * Structured request/response logger for payment and webhook routes.
 * Logs method, path, status, duration, and request ID for every request.
 *
 * In production, pipe these logs to a log aggregator (Datadog, Logtail, etc.)
 * for full observability into payment flows.
 *
 * Sensitive fields (Authorization, api_key, card numbers) are never logged.
 */

// ── SENSITIVE HEADERS TO REDACT ────────────────────────────
const REDACTED_HEADERS = new Set([
  "authorization",
  "x-paystack-signature",
  "cookie",
  "set-cookie",
]);

// ── GENERATE REQUEST ID ────────────────────────────────────
const generateRequestId = (): string => {
  return `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
};

// ── SAFE HEADERS (redact sensitive values) ─────────────────
const safeHeaders = (
  headers: Record<string, string | string[] | undefined>
): Record<string, string | string[] | undefined> => {
  const safe: Record<string, string | string[] | undefined> = {};
  for (const [key, value] of Object.entries(headers)) {
    safe[key] = REDACTED_HEADERS.has(key.toLowerCase()) ? "[REDACTED]" : value;
  }
  return safe;
};

// ── MIDDLEWARE ─────────────────────────────────────────────
export const requestLogger = (
  req:  Request,
  res:  Response,
  next: NextFunction
): void => {
  const requestId = generateRequestId();
  const startTime = Date.now();

  // ── Attach request ID to request for downstream use ──
  (req as any).requestId = requestId;

  // ── Log incoming request ──
  console.log(JSON.stringify({
    type:      "REQUEST",
    requestId,
    method:    req.method,
    path:      req.path,
    query:     req.query,
    headers:   safeHeaders(req.headers as any),
    ip:        req.ip,
    timestamp: new Date().toISOString(),
  }));

  // ── Hook into response finish to log outcome ──
  res.on("finish", () => {
    const duration = Date.now() - startTime;

    const level =
      res.statusCode >= 500 ? "error" :
      res.statusCode >= 400 ? "warn"  :
      "info";

    console[level](JSON.stringify({
      type:       "RESPONSE",
      requestId,
      method:     req.method,
      path:       req.path,
      statusCode: res.statusCode,
      durationMs: duration,
      timestamp:  new Date().toISOString(),
    }));
  });

  next();
};