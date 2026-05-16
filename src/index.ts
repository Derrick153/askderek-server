import express, {
  Request,
  Response,
  NextFunction,
}                           from "express";
import dotenv               from "dotenv";
import cors                 from "cors";
import helmet               from "helmet";
import morgan               from "morgan";
import rateLimit            from "express-rate-limit";
import { clerkMiddleware }  from "@clerk/express";

// ── ROUTES ────────────────────────────────────────────────
// Phase 1 and 2 routes — foundation and verification
import propertyRoutes       from "./routes/propertyRoutes";
import tenantRoutes         from "./routes/tenantRoutes";
import managerRoutes        from "./routes/managerRoutes";
import applicationRoutes    from "./routes/applicationRoutes";
import leaseRoutes          from "./routes/leaseRoutes";
import webhookRoutes        from "./routes/webhookRoutes";
import paymentRoutes        from "./routes/paymentRoutes";
import adminRoutes          from "./routes/adminRoutes";
import adminPaymentRoutes   from "./routes/adminPaymentRoutes";
import authRoutes           from "./routes/authRoutes";
import otpRoutes            from "./routes/otpRoutes";
import locationRoutes       from "./routes/locationRoutes";
// Phase 3.5 routes — property types and payment structures
import saleRoutes           from "./routes/saleRoutes";
import enquiryRoutes        from "./routes/enquiryRoutes";
import messageRoutes        from "./routes/messageRoutes";
import bookingRoutes        from "./routes/bookingRoutes";
import hostelRoutes         from "./routes/hostelRoutes";
import schoolRoutes         from "./routes/schoolRoutes";
import advancePaymentRoutes from "./routes/advancePaymentRoutes";
import leaseExpiryRoutes    from "./routes/leaseExpiryRoutes";
import verifyRoutes         from "./routes/verifyRoutes";
import auditRoutes          from "./routes/auditRoutes";

// ── JOBS ──────────────────────────────────────────────────
// Phase 1 and 2 jobs
import { startOverduePaymentJob } from "./jobs/overduePaymentJob";
import { startPaymentExpiryJob }  from "./jobs/paymentExpiryJob";
import { startReminderJob }       from "./jobs/reminderJob";
import { startReconciliationJob } from "./jobs/reconciliationJob";
// Phase 3.5 jobs
import { startLeaseExpiryJob }    from "./jobs/leaseExpiryJob";
import { startShortStayExpiryJob } from "./jobs/shortStayExpiryJob";
import { startSemesterExpiryJob } from "./jobs/semesterExpiryJob";
import { startPendingRemovalJob } from "./jobs/pendingRemovalJob";

dotenv.config();

const app      = express();
const PORT     = process.env.PORT     || 5000;
const NODE_ENV = process.env.NODE_ENV || "development";

// ── CORS ──────────────────────────────────────────────────
// In development with no ALLOWED_ORIGINS set all origins are allowed.
// In production only origins listed in ALLOWED_ORIGINS env var pass.
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

const corsOptions: cors.CorsOptions = {
  origin: (origin, callback) => {
    const isDev = NODE_ENV === "development" && ALLOWED_ORIGINS.length === 0;
    if (!origin || isDev || ALLOWED_ORIGINS.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error(`CORS: origin "${origin}" is not allowed`));
    }
  },
  credentials:    true,
  methods:        ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
};

// ── RATE LIMITERS ─────────────────────────────────────────
// Global limiter applied to all /api routes.
// Specific routes get additional targeted limiters in their route files.
const generalLimiter = rateLimit({
  windowMs:        15 * 60 * 1000,
  max:             100,
  message:         { success: false, message: "Too many requests. Please try again later." },
  standardHeaders: true,
  legacyHeaders:   false,
});

// Auth routes limited more strictly — prevents brute force attacks
const authLimiter = rateLimit({
  windowMs:        15 * 60 * 1000,
  max:             10,
  message:         { success: false, message: "Too many auth attempts. Please try again later." },
  standardHeaders: true,
  legacyHeaders:   false,
});

// OTP routes — very strict — max 3 per minute
// Prevents OTP farming and phone number enumeration
const otpLimiter = rateLimit({
  windowMs:        60 * 1000,
  max:             3,
  message:         { success: false, message: "Too many OTP requests. Please wait 1 minute." },
  standardHeaders: true,
  legacyHeaders:   false,
});

// Payment routes limited separately — prevents payment spam
const paymentLimiter = rateLimit({
  windowMs:        15 * 60 * 1000,
  max:             30,
  message:         { success: false, message: "Too many payment requests. Please try again later." },
  standardHeaders: true,
  legacyHeaders:   false,
});

// ── WEBHOOK ROUTES ────────────────────────────────────────
// Registered BEFORE express.json() — critical for Paystack webhooks.
// Paystack signature verification requires the raw request body bytes.
// If express.json() runs first it parses the body and the raw bytes are lost.
// HMAC-SHA512 verification will fail and all webhooks will be rejected.
app.use("/api/webhooks", webhookRoutes);

// ── CORE MIDDLEWARE ───────────────────────────────────────
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));
app.use(helmet());
app.use(helmet.crossOriginResourcePolicy({ policy: "cross-origin" }));
app.use(cors(corsOptions));
app.use(morgan(NODE_ENV === "production" ? "combined" : "dev"));

// ── CLERK MIDDLEWARE ──────────────────────────────────────
// Registered BEFORE any route that uses requireAuth().
// Attaches req.auth to every incoming request.
// Controllers call req.auth?.userId to get the verified Clerk identity.
// Without this middleware requireAuth() returns null on every request.
app.use(clerkMiddleware());
app.use((req: Request, _res: Response, next: NextFunction) => {
  console.log("AUTH DEBUG:", req.path, req.auth?.userId ?? "NO USER");
  next();
});

// ── RATE LIMITING ─────────────────────────────────────────
app.use("/api",          generalLimiter);
app.use("/api/auth",     authLimiter);
app.use("/api/otp",      otpLimiter);
app.use("/api/payments", paymentLimiter);

// ── API ROUTES ────────────────────────────────────────────

// Phase 1 and 2 — foundation · verification · payments
app.use("/api/auth",              authRoutes);
app.use("/api/otp",               otpRoutes);
app.use("/api/locations",         locationRoutes);
app.use("/api/properties",        propertyRoutes);
app.use("/api/tenants",           tenantRoutes);
app.use("/api/managers",          managerRoutes);
app.use("/api/applications",      applicationRoutes);
app.use("/api/leases",            leaseRoutes);
app.use("/api/payments",          paymentRoutes);
app.use("/api/admin",             adminRoutes);
app.use("/api/admin/payments",    adminPaymentRoutes);

// Phase 3.5 — property types · sale · enquiry · messaging · bookings
app.use("/api/sale",              saleRoutes);
app.use("/api/enquiries",         enquiryRoutes);
app.use("/api/messages",          messageRoutes);
app.use("/api/bookings",          bookingRoutes);
app.use("/api/hostels",           hostelRoutes);
app.use("/api/schools",           schoolRoutes);
app.use("/api/advance-payments",  advancePaymentRoutes);
app.use("/api/lease-expiry",      leaseExpiryRoutes);
app.use("/api/verify",            verifyRoutes);
app.use("/api/audit",             auditRoutes);

// ── HEALTH CHECK ──────────────────────────────────────────
// Public endpoint — no auth required.
// Used by Railway / Render to confirm server is alive.
app.get("/health", (_req: Request, res: Response) => {
  res.json({
    status:      "ok",
    app:         "AskDerek API",
    environment: NODE_ENV,
    timestamp:   new Date().toISOString(),
  });
});

// ── 404 HANDLER ───────────────────────────────────────────
// Catches any request that did not match a registered route.
app.use((_req: Request, res: Response) => {
  res.status(404).json({ success: false, message: "Route not found" });
});

// ── GLOBAL ERROR HANDLER ──────────────────────────────────
// Catches any unhandled errors thrown inside route handlers.
// In development the full error message is returned for debugging.
// In production only a generic message is returned — internals never exposed.
app.use((
  err:   Error & { status?: number },
  _req:  Request,
  res:   Response,
  _next: NextFunction
) => {
  console.error("❌ Unhandled error:", {
    message: err.message,
    stack:   NODE_ENV === "development" ? err.stack : undefined,
  });
  res.status(err.status || 500).json({
    success: false,
    message: NODE_ENV === "development" ? err.message : "Internal server error",
  });
});

// ── START SERVER ──────────────────────────────────────────
const server = app.listen(PORT, () => {
  console.log(`\n🚀 AskDerek API is running`);
  console.log(`🔍 URL:       http://localhost:${PORT}`);
  console.log(`❤️  Health:    http://localhost:${PORT}/health`);

  console.log(`\n── Phase 1 and 2 ────────────────────────────`);
  console.log(`🔗 Clerk:     http://localhost:${PORT}/api/webhooks/clerk`);
  console.log(`💳 Paystack:  http://localhost:${PORT}/api/webhooks/paystack`);
  console.log(`🔐 Auth:      http://localhost:${PORT}/api/auth`);
  console.log(`📱 OTP:       http://localhost:${PORT}/api/otp`);
  console.log(`📍 Locations: http://localhost:${PORT}/api/locations`);
  console.log(`🏘️  Properties:http://localhost:${PORT}/api/properties`);
  console.log(`👑 Admin:     http://localhost:${PORT}/api/admin`);
  console.log(`💰 Payments:  http://localhost:${PORT}/api/payments`);

  console.log(`\n── Phase 3.5 ────────────────────────────────`);
  console.log(`🏠 Sale:      http://localhost:${PORT}/api/sale`);
  console.log(`💬 Enquiries: http://localhost:${PORT}/api/enquiries`);
  console.log(`📨 Messages:  http://localhost:${PORT}/api/messages`);
  console.log(`📅 Bookings:  http://localhost:${PORT}/api/bookings`);
  console.log(`🏫 Hostels:   http://localhost:${PORT}/api/hostels`);
  console.log(`🎓 Schools:   http://localhost:${PORT}/api/schools`);
  console.log(`💵 Advance:   http://localhost:${PORT}/api/advance-payments`);
  console.log(`📋 Expiry:    http://localhost:${PORT}/api/lease-expiry`);
  console.log(`🔍 Verify:    http://localhost:${PORT}/api/verify`);
  console.log(`📊 Audit:     http://localhost:${PORT}/api/audit`);

  console.log(`\n🌍 ENV:       ${NODE_ENV}\n`);

  // ── START CRON JOBS ───────────────────────────────────
  // Phase 1 and 2 jobs
  startOverduePaymentJob();
  startPaymentExpiryJob();
  startReminderJob();
  startReconciliationJob();
  // Phase 3.5 jobs
  startLeaseExpiryJob();
  startShortStayExpiryJob();
  startSemesterExpiryJob();
  startPendingRemovalJob();
});

// ── GRACEFUL SHUTDOWN ─────────────────────────────────────
// Handles SIGTERM from Railway/Render and SIGINT from Ctrl+C.
// Gives active connections 10 seconds to finish before forcing exit.
const shutdown = (signal: string): void => {
  console.log(`\n⚠️  ${signal} received — shutting down gracefully...`);
  server.close(() => {
    console.log("✅ Server closed. Goodbye.");
    process.exit(0);
  });
  setTimeout(() => {
    console.error("❌ Forced shutdown after timeout.");
    process.exit(1);
  }, 10_000);
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT",  () => shutdown("SIGINT"));

process.on("unhandledRejection", (reason) => {
  console.error("❌ Unhandled Promise Rejection:", reason);
  shutdown("unhandledRejection");
});