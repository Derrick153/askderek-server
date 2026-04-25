// ─────────────────────────────────────────────────────────────────────────────
//  auditRoutes.ts
//
//  Audit log routes for AskDerek — Derek only.
//
//  No separate controller needed.
//  All audit records are written by auditService.ts automatically.
//  These routes only READ the audit log — never write.
//
//  All routes require admin authentication.
//  Admin role verified inside each handler via database check.
//  clerkMiddleware() registered globally in index.ts.
// ─────────────────────────────────────────────────────────────────────────────

import { Router, Request, Response } from "express";
import rateLimit                     from "express-rate-limit";
import { requireAuth }               from "@clerk/express";
import { prisma }                    from "../lib/prisma";

const router = Router();

// ── RESPONSE TYPES ────────────────────────────────────────────────────────────

interface ApiSuccess<T = unknown> {
  success: true;
  message: string;
  data?:   T;
}

interface ApiError {
  success: false;
  message: string;
  errors?: { field: string; message: string }[];
}

type ApiResponse<T = unknown> = ApiSuccess<T> | ApiError;

// ── SHARED HELPERS ────────────────────────────────────────────────────────────

// Verifies caller is an active admin via database check.
// JWT alone is not trusted for admin actions.
const requireAdminAuth = async (
  req: Request,
  res: Response
): Promise<string | null> => {
  const userId = req.auth?.userId;
  if (!userId) {
    res.status(401).json({ success: false, message: "Unauthorized" });
    return null;
  }
  const user = await prisma.user.findUnique({
    where:  { clerkId: userId },
    select: { role: true, isActive: true },
  });
  if (!user || user.role !== "ADMIN" || !user.isActive) {
    res.status(403).json({ success: false, message: "Forbidden" });
    return null;
  }
  return userId;
};

// ── RATE LIMITERS ─────────────────────────────────────────────────────────────

const adminLimiter = rateLimit({
  windowMs:        15 * 60 * 1000,
  max:             50,
  standardHeaders: true,
  legacyHeaders:   false,
  message:         { success: false, message: "Too many requests. Please slow down." },
});

// ── ROUTES ────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
//  GET ALL AUDIT LOGS
//  GET /api/audit
//
//  Returns all audit log entries — Derek only.
//  Paginated — audit log grows large over time.
//  Filterable by action type via ?action=PAYMENT_RECEIVED
//  Filterable by target via ?target=Property
// ─────────────────────────────────────────────────────────────────────────────
router.get(
  "/",
  requireAuth(),
  adminLimiter,
  async (req: Request, res: Response<ApiResponse>) => {
    const adminClerkId = await requireAdminAuth(req, res);
    if (!adminClerkId) return;

    const page   = Math.max(1,  Number(req.query.page)   || 1);
    const limit  = Math.min(50, Number(req.query.limit)  || 20);
    const skip   = (page - 1) * limit;
    const action = req.query.action as string | undefined;
    const target = req.query.target as string | undefined;

    try {
      const where = {
        ...(action ? { action: { contains: action, mode: "insensitive" as const } } : {}),
        ...(target ? { target: { contains: target, mode: "insensitive" as const } } : {}),
      };

      const [logs, total] = await Promise.all([
        prisma.auditLog.findMany({
          skip,
          take:    limit,
          where,
          orderBy: { createdAt: "desc" },
        }),
        prisma.auditLog.count({ where }),
      ]);

      res.status(200).json({
        success: true,
        message: "Audit logs retrieved",
        data: {
          logs,
          pagination: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit),
          },
        },
      });
    } catch (error) {
      console.error("[auditRoutes.getAllLogs]", {
        adminClerkId,
        error: error instanceof Error ? error.message : error,
      });
      res.status(500).json({ success: false, message: "Internal server error" });
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
//  GET AUDIT LOG BY ID
//  GET /api/audit/:logId
//
//  Returns a single audit log entry by ID.
//  Used when Derek needs to investigate a specific event.
// ─────────────────────────────────────────────────────────────────────────────
router.get(
  "/:logId",
  requireAuth(),
  adminLimiter,
  async (req: Request, res: Response<ApiResponse>) => {
    const adminClerkId = await requireAdminAuth(req, res);
    if (!adminClerkId) return;

    const logId = Number(req.params.logId);
    if (isNaN(logId) || logId <= 0) {
      res.status(400).json({ success: false, message: "Invalid logId" });
      return;
    }

    try {
      const log = await prisma.auditLog.findUnique({
        where: { id: logId },
      });

      if (!log) {
        res.status(404).json({
          success: false,
          message: "Audit log entry not found",
        });
        return;
      }

      res.status(200).json({
        success: true,
        message: "Audit log entry retrieved",
        data:    log,
      });
    } catch (error) {
      console.error("[auditRoutes.getLogById]", {
        logId,
        adminClerkId,
        error: error instanceof Error ? error.message : error,
      });
      res.status(500).json({ success: false, message: "Internal server error" });
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
//  GET AUDIT LOGS BY PAYMENT
//  GET /api/audit/payment/:paymentId
//
//  Returns all audit entries for a specific payment.
//  Used by Derek to trace the full history of a payment.
// ─────────────────────────────────────────────────────────────────────────────
router.get(
  "/payment/:paymentId",
  requireAuth(),
  adminLimiter,
  async (req: Request, res: Response<ApiResponse>) => {
    const adminClerkId = await requireAdminAuth(req, res);
    if (!adminClerkId) return;

    const paymentId = Number(req.params.paymentId);
    if (isNaN(paymentId) || paymentId <= 0) {
      res.status(400).json({ success: false, message: "Invalid paymentId" });
      return;
    }

    try {
      const logs = await prisma.auditLog.findMany({
        where: {
          target: {
            contains: `Payment #${paymentId}`,
            mode:     "insensitive",
          },
        },
        orderBy: { createdAt: "desc" },
      });

      res.status(200).json({
        success: true,
        message: `${logs.length} audit log(s) found for Payment #${paymentId}`,
        data:    logs,
      });
    } catch (error) {
      console.error("[auditRoutes.getLogsByPayment]", {
        paymentId,
        adminClerkId,
        error: error instanceof Error ? error.message : error,
      });
      res.status(500).json({ success: false, message: "Internal server error" });
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
//  GET AUDIT LOGS BY USER
//  GET /api/audit/user/:clerkId
//
//  Returns all audit entries for a specific user.
//  Used by Derek to investigate user activity.
// ─────────────────────────────────────────────────────────────────────────────
router.get(
  "/user/:clerkId",
  requireAuth(),
  adminLimiter,
  async (req: Request, res: Response<ApiResponse>) => {
    const adminClerkId = await requireAdminAuth(req, res);
    if (!adminClerkId) return;

    const { clerkId } = req.params;

    if (!clerkId || clerkId.trim().length === 0) {
      res.status(400).json({ success: false, message: "Invalid clerkId" });
      return;
    }

    try {
      const logs = await prisma.auditLog.findMany({
        where: {
          OR: [
            { userClerkId: clerkId },
            { details: { contains: clerkId, mode: "insensitive" } },
          ],
        },
        orderBy: { createdAt: "desc" },
      });

      res.status(200).json({
        success: true,
        message: `${logs.length} audit log(s) found for user ${clerkId}`,
        data:    logs,
      });
    } catch (error) {
      console.error("[auditRoutes.getLogsByUser]", {
        clerkId,
        adminClerkId,
        error: error instanceof Error ? error.message : error,
      });
      res.status(500).json({ success: false, message: "Internal server error" });
    }
  }
);

export default router;