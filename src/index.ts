import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";

// Routes
import propertyRoutes from "./routes/propertyRoutes";
import tenantRoutes from "./routes/tenantRoutes";
import managerRoutes from "./routes/managerRoutes";
import applicationRoutes from "./routes/applicationRoutes";
import leaseRoutes from "./routes/leaseRoutes";
import webhookRoutes from "./routes/webhookRoutes";
import paymentRoutes from "./routes/paymentRoutes";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;
const NODE_ENV = process.env.NODE_ENV || "development";

// ─── WEBHOOK ROUTE (must be before express.json()) ───────────────────────────
// Paystack & Clerk webhooks need raw body — do NOT move this below json()
app.use("/api/webhooks", webhookRoutes);

// ─── CORE MIDDLEWARE ──────────────────────────────────────────────────────────
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

app.use(helmet());
app.use(helmet.crossOriginResourcePolicy({ policy: "cross-origin" }));

app.use(
  cors({
    origin: process.env.CLIENT_URL || "http://localhost:3000",
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

// Log format: dev = colorful, production = combined (for log aggregators)
app.use(morgan(NODE_ENV === "production" ? "combined" : "dev"));

// ─── API ROUTES ───────────────────────────────────────────────────────────────
app.use("/api/properties", propertyRoutes);
app.use("/api/tenants", tenantRoutes);
app.use("/api/managers", managerRoutes);
app.use("/api/applications", applicationRoutes);
app.use("/api/leases", leaseRoutes);
app.use("/api/payments", paymentRoutes);

// ─── HEALTH CHECK ─────────────────────────────────────────────────────────────
app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    app: "RentGhana API",
    environment: NODE_ENV,
    timestamp: new Date().toISOString(),
  });
});

// ─── 404 HANDLER ─────────────────────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ error: "Route not found" });
});

// ─── GLOBAL ERROR HANDLER ────────────────────────────────────────────────────
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
      // Only expose stack trace in development
      ...(NODE_ENV === "development" && { stack: err.stack }),
    });
  }
);

// ─── START SERVER ────────────────────────────────────────────────────────────
const server = app.listen(PORT, () => {
  console.log(`\n🚀 RentGhana API is running`);
  console.log(`📍 URL:     http://localhost:${PORT}`);
  console.log(`❤️  Health:  http://localhost:${PORT}/health`);
  console.log(`🔗 Clerk:   http://localhost:${PORT}/api/webhooks/clerk`);
  console.log(`💳 Paystack: http://localhost:${PORT}/api/webhooks/paystack`);
  console.log(`🌍 ENV:     ${NODE_ENV}\n`);
});

// ─── GRACEFUL SHUTDOWN ───────────────────────────────────────────────────────
// Ensures DB connections close cleanly when server stops (e.g. on Render/Railway)
const shutdown = (signal: string) => {
  console.log(`\n⚠️  ${signal} received — shutting down gracefully...`);
  server.close(() => {
    console.log("✅ Server closed. Goodbye.");
    process.exit(0);
  });

  // Force exit if shutdown takes longer than 10 seconds
  setTimeout(() => {
    console.error("❌ Forced shutdown after timeout.");
    process.exit(1);
  }, 10_000);
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

// Catch unhandled promise rejections (e.g. Prisma errors not caught in controllers)
process.on("unhandledRejection", (reason) => {
  console.error("❌ Unhandled Promise Rejection:", reason);
});