// server/src/index.ts
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
import webhookRoutes from "./routes/webhookRoutes"; // NEW

// Config
dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// IMPORTANT: Webhook route MUST come before express.json()
// Clerk webhooks need raw body for signature verification
app.use("/api/webhooks", webhookRoutes);

// Middleware (applied AFTER webhook route)
app.use(express.json());
app.use(helmet());
app.use(helmet.crossOriginResourcePolicy({ policy: "cross-origin" }));
app.use(morgan("dev"));
app.use(cors({
  origin: process.env.CLIENT_URL || "http://localhost:3000",
  credentials: true,
}));

// Routes
app.use("/api/properties", propertyRoutes);
app.use("/api/tenants", tenantRoutes);
app.use("/api/managers", managerRoutes);
app.use("/api/applications", applicationRoutes);
app.use("/api/leases", leaseRoutes);

// Health check
app.get("/", (req, res) => {
  res.json({ 
    message: "AskDerek API Server", 
    status: "running",
    timestamp: new Date().toISOString() 
  });
});

// Error handling
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error("❌ Error:", err);
  res.status(err.status || 500).json({
    error: err.message || "Internal server error",
    ...(process.env.NODE_ENV === "development" && { stack: err.stack }),
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📍 API: http://localhost:${PORT}`);
  console.log(`🔗 Webhook: http://localhost:${PORT}/api/webhooks/clerk`);
});