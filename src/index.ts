import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import rateLimit from "express-rate-limit";

// Routes
import propertyRoutes from "./routes/propertyRoutes";
import tenantRoutes from "./routes/tenantRoutes";
import managerRoutes from "./routes/managerRoutes";
import applicationRoutes from "./routes/applicationRoutes";
import leaseRoutes from "./routes/leaseRoutes";
import webhookRoutes from "./routes/webhookRoutes";
import paymentRoutes from "./routes/paymentRoutes";
import adminRoutes from "./routes/adminRoutes";
import authRoutes from "./routes/authRoutes";
import otpRoutes from "./routes/otpRoutes";
import locationRoutes from "./routes/locationRoutes";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;
const NODE_ENV = process.env.NODE_ENV || "development";

// ── CORS ORIGIN WHITELIST ─────────────────────────────────────────────────────
//  Set ALLOWED_ORIGINS in .env as a comma-separated list:
//  ALLOWED_ORIGINS=https://askderek.com,https://www.askderek.com
//
//  In development, if ALLOWED_ORIGINS is empty, all origins are allowed so
//  you can work freely with localhost — but never in production.
// ─────────────────────────────────────────────────────────────────────────────
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

const corsOptions: cors.CorsOptions = {
  origin: (origin, callback) => {
    // Allow server-to-server / curl requests (no Origin header) and whitelisted origins.
    // In development with no ALLOWED_ORIGINS set, allow everything.
    const isDev = NODE_ENV === "development" && ALLOWED_ORIGINS.length === 0;
    if (!origin || isDev || ALLOWED_ORIGINS.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error(`CORS: origin "${origin}" is not allowed`));
    }
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
};

// ── RATE LIMITING ─────────────────────────────────────────────────────────────
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { error: "Too many requests. Please try again later." },
  standardHeaders: true,
  legacyHeaders: false,
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: "Too many auth attempts. Please try again later." },
  standardHeaders: true,
  legacyHeaders: false,
});

const otpLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 3,
  message: { error: "Too many OTP requests. Please wait 1 minute." },
  standardHeaders: true,
  legacyHeaders: false,
});

// ── WEBHOOK ROUTE (must be before express.json()) ─────────────────────────────
//  Paystack & Clerk webhooks need the raw request body for signature verification.
//  Parsing it as JSON first would break the HMAC check.
// ─────────────────────────────────────────────────────────────────────────────
app.use("/api/webhooks", webhookRoutes);

// ── CORE MIDDLEWARE ───────────────────────────────────────────────────────────
//  1mb is generous for any property listing payload.
//  If you accept base64 image uploads in JSON, switch to multipart/form-data
//  or direct-to-S3 uploads instead of raising this limit.
// ─────────────────────────────────────────────────────────────────────────────
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));
app.use(helmet());
app.use(helmet.crossOriginResourcePolicy({ policy: "cross-origin" }));
app.use(cors(corsOptions));
app.use(morgan(NODE_ENV === "production" ? "combined" : "dev"));

// ── APPLY RATE LIMITING ───────────────────────────────────────────────────────
app.use("/api", generalLimiter);
app.use("/api/auth", authLimiter);
app.use("/api/otp", otpLimiter);

// ── API ROUTES ────────────────────────────────────────────────────────────────
app.use("/api/auth", authRoutes);
app.use("/api/otp", otpRoutes);
app.use("/api/locations", locationRoutes);
app.use("/api/properties", propertyRoutes);
app.use("/api/tenants", tenantRoutes);
app.use("/api/managers", managerRoutes);
app.use("/api/applications", applicationRoutes);
app.use("/api/leases", leaseRoutes);
app.use("/api/payments", paymentRoutes);
app.use("/api/admin", adminRoutes);

// ── HEALTH CHECK ──────────────────────────────────────────────────────────────
app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    app: "AskDerek API",
    environment: NODE_ENV,
    timestamp: new Date().toISOString(),
  });
});

// ── 404 HANDLER ───────────────────────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ error: "Route not found" });
});

// ── GLOBAL ERROR HANDLER ──────────────────────────────────────────────────────
app.use(
  (
    err: any,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction
  ) => {
    console.error("❌ Unhandled error:", err);
    res.status(err.status || 500).json({
      error: err.message || "Internal server error",
      ...(NODE_ENV === "development" && { stack: err.stack }),
    });
  }
);

// ── START SERVER ──────────────────────────────────────────────────────────────
const server = app.listen(PORT, () => {
  console.log(`\n🚀 AskDerek API is running`);
  console.log(`🔍 URL:      http://localhost:${PORT}`);
  console.log(`❤️  Health:   http://localhost:${PORT}/health`);
  console.log(`🔗 Clerk:    http://localhost:${PORT}/api/webhooks/clerk`);
  console.log(`💳 Paystack: http://localhost:${PORT}/api/webhooks/paystack`);
  console.log(`👑 Admin:    http://localhost:${PORT}/api/admin`);
  console.log(`🔐 Auth:     http://localhost:${PORT}/api/auth`);
  console.log(`📱 OTP:      http://localhost:${PORT}/api/otp`);
  console.log(`🌍 ENV:      ${NODE_ENV}\n`);
  console.log(`📍 Locations: http://localhost:${PORT}/api/locations`);
});

// ── GRACEFUL SHUTDOWN ─────────────────────────────────────────────────────────
//  Stops accepting new connections, waits up to 10s for active ones to finish,
//  then exits so the process manager (PM2 / Railway / Render) can restart clean.
// ─────────────────────────────────────────────────────────────────────────────
const shutdown = (signal: string) => {
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
process.on("SIGINT", () => shutdown("SIGINT"));

// ── UNHANDLED PROMISE REJECTIONS ──────────────────────────────────────────────
//  Log the crash reason then trigger a graceful shutdown so the process manager
//  can restart the server in a clean state — far safer than limping on.
// ─────────────────────────────────────────────────────────────────────────────
process.on("unhandledRejection", (reason) => {
  console.error("❌ Unhandled Promise Rejection:", reason);
  shutdown("unhandledRejection");
});