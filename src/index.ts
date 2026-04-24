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
import propertyRoutes     from "./routes/propertyRoutes";
import tenantRoutes       from "./routes/tenantRoutes";
import managerRoutes      from "./routes/managerRoutes";
import applicationRoutes  from "./routes/applicationRoutes";
import leaseRoutes        from "./routes/leaseRoutes";
import webhookRoutes      from "./routes/webhookRoutes";
import paymentRoutes      from "./routes/paymentRoutes";
import adminRoutes        from "./routes/adminRoutes";
import adminPaymentRoutes from "./routes/adminPaymentRoutes";
import authRoutes         from "./routes/authRoutes";
import otpRoutes          from "./routes/otpRoutes";
import locationRoutes     from "./routes/locationRoutes";
import saleRoutes         from "./routes/saleRoutes";
import enquiryRoutes      from "./routes/enquiryRoutes";

// ── JOBS ──────────────────────────────────────────────────
import { startOverduePaymentJob } from "./jobs/overduePaymentJob";
import { startPaymentExpiryJob }  from "./jobs/paymentExpiryJob";
import { startReminderJob }       from "./jobs/reminderJob";
import { startReconciliationJob } from "./jobs/reconciliationJob";

dotenv.config();

const app      = express();
const PORT     = process.env.PORT     || 5000;
const NODE_ENV = process.env.NODE_ENV || "development";

// ── CORS ──────────────────────────────────────────────────
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
const generalLimiter = rateLimit({
  windowMs:        15 * 60 * 1000,
  max:             100,
  message:         { success: false, message: "Too many requests. Please try again later." },
  standardHeaders: true,
  legacyHeaders:   false,
});

const authLimiter = rateLimit({
  windowMs:        15 * 60 * 1000,
  max:             10,
  message:         { success: false, message: "Too many auth attempts. Please try again later." },
  standardHeaders: true,
  legacyHeaders:   false,
});

const otpLimiter = rateLimit({
  windowMs:        60 * 1000,
  max:             3,
  message:         { success: false, message: "Too many OTP requests. Please wait 1 minute." },
  standardHeaders: true,
  legacyHeaders:   false,
});

const paymentLimiter = rateLimit({
  windowMs:        15 * 60 * 1000,
  max:             30,
  message:         { success: false, message: "Too many payment requests. Please try again later." },
  standardHeaders: true,
  legacyHeaders:   false,
});

// ── WEBHOOK ROUTES ────────────────────────────────────────
// Must be registered BEFORE express.json() so rawBody is preserved
// for Paystack HMAC-SHA512 signature verification.
app.use("/api/webhooks", webhookRoutes);

// ── CORE MIDDLEWARE ───────────────────────────────────────
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));
app.use(helmet());
app.use(helmet.crossOriginResourcePolicy({ policy: "cross-origin" }));
app.use(cors(corsOptions));
app.use(morgan(NODE_ENV === "production" ? "combined" : "dev"));

// ── CLERK MIDDLEWARE ──────────────────────────────────────
// Must be registered BEFORE any route that uses requireAuth().
// This attaches req.auth to every request so controllers
// can safely call req.auth?.userId to get the verified identity.
app.use(clerkMiddleware());

// ── RATE LIMITING ─────────────────────────────────────────
app.use("/api",          generalLimiter);
app.use("/api/auth",     authLimiter);
app.use("/api/otp",      otpLimiter);
app.use("/api/payments", paymentLimiter);

// ── API ROUTES ────────────────────────────────────────────
app.use("/api/auth",           authRoutes);
app.use("/api/otp",            otpRoutes);
app.use("/api/locations",      locationRoutes);
app.use("/api/properties",     propertyRoutes);
app.use("/api/tenants",        tenantRoutes);
app.use("/api/managers",       managerRoutes);
app.use("/api/applications",   applicationRoutes);
app.use("/api/leases",         leaseRoutes);
app.use("/api/payments",       paymentRoutes);
app.use("/api/admin",          adminRoutes);
app.use("/api/admin/payments", adminPaymentRoutes);
app.use("/api/sale",           saleRoutes);
app.use("/api/enquiries",      enquiryRoutes);

// ── HEALTH CHECK ──────────────────────────────────────────
app.get("/health", (_req: Request, res: Response) => {
  res.json({
    status:      "ok",
    app:         "AskDerek API",
    environment: NODE_ENV,
    timestamp:   new Date().toISOString(),
  });
});

// ── 404 HANDLER ───────────────────────────────────────────
app.use((_req: Request, res: Response) => {
  res.status(404).json({ success: false, message: "Route not found" });
});

// ── GLOBAL ERROR HANDLER ──────────────────────────────────
// err typed as Error instead of any — strict TypeScript compliant
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
  console.log(`🔗 Clerk:     http://localhost:${PORT}/api/webhooks/clerk`);
  console.log(`💳 Paystack:  http://localhost:${PORT}/api/webhooks/paystack`);
  console.log(`👑 Admin:     http://localhost:${PORT}/api/admin`);
  console.log(`💰 Payments:  http://localhost:${PORT}/api/payments`);
  console.log(`🔐 Auth:      http://localhost:${PORT}/api/auth`);
  console.log(`📱 OTP:       http://localhost:${PORT}/api/otp`);
  console.log(`📍 Locations: http://localhost:${PORT}/api/locations`);
  console.log(`🏠 Sale:      http://localhost:${PORT}/api/sale`);
  console.log(`💬 Enquiries: http://localhost:${PORT}/api/enquiries`);
  console.log(`🌍 ENV:       ${NODE_ENV}\n`);

  startOverduePaymentJob();
  startPaymentExpiryJob();
  startReminderJob();
  startReconciliationJob();
});

// ── GRACEFUL SHUTDOWN ─────────────────────────────────────
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