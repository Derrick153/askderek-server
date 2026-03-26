import { Router } from "express";
import {
  createAdmin,
  getAdmin,
  getDashboardStats,
  getPendingProperties,
  approveProperty,
  rejectProperty,
  getAllProperties,
  getPendingVerifications,
  approveVerification,
  rejectVerification,
  getAllManagers,
  getAllTenants,
  addToBlacklist,
  getBlacklist,
  removeFromBlacklist,
  getAllReports,
  resolveReport,
  getAuditLogs,
  deleteAdmin,
} from "../controllers/adminControllers";
import { authMiddleware } from "../middleware/authMiddleware";
import { requireAdmin } from "../middleware/requireAdmin";

const router = Router();

// ── ADMIN AUTH — NO requireAdmin here ─────────────────────
// createAdmin has no protection so you can create the first admin
router.post("/", createAdmin);

// ── DASHBOARD ──────────────────────────────────────────────
router.get("/dashboard/stats", authMiddleware(), requireAdmin, getDashboardStats);

// ── PROPERTY MODERATION ────────────────────────────────────
router.get("/properties/all", authMiddleware(), requireAdmin, getAllProperties);
router.get("/properties/pending", authMiddleware(), requireAdmin, getPendingProperties);
router.put("/properties/:id/approve", authMiddleware(), requireAdmin, approveProperty);
router.put("/properties/:id/reject", authMiddleware(), requireAdmin, rejectProperty);

// ── LANDLORD VERIFICATION ──────────────────────────────────
router.get("/verifications/pending", authMiddleware(), requireAdmin, getPendingVerifications);
router.put("/verifications/:id/approve", authMiddleware(), requireAdmin, approveVerification);
router.put("/verifications/:id/reject", authMiddleware(), requireAdmin, rejectVerification);

// ── USER MANAGEMENT ────────────────────────────────────────
router.get("/users/managers", authMiddleware(), requireAdmin, getAllManagers);
router.get("/users/tenants", authMiddleware(), requireAdmin, getAllTenants);

// ── BLACKLIST ──────────────────────────────────────────────
router.get("/blacklist", authMiddleware(), requireAdmin, getBlacklist);
router.post("/blacklist", authMiddleware(), requireAdmin, addToBlacklist);
router.delete("/blacklist/:id", authMiddleware(), requireAdmin, removeFromBlacklist);

// ── ADMIN MANAGEMENT ────────────────────────────────────────
router.delete("/:id", authMiddleware(), requireAdmin, deleteAdmin);

// ── REPORTS ────────────────────────────────────────────────
router.get("/reports", authMiddleware(), requireAdmin, getAllReports);
router.put("/reports/:id/resolve", authMiddleware(), requireAdmin, resolveReport);

// ── AUDIT LOGS ─────────────────────────────────────────────
router.get("/audit-logs", authMiddleware(), requireAdmin, getAuditLogs);

// ── GET ADMIN — MUST BE LAST ───────────────────────────────
router.get("/:clerkId", authMiddleware(), requireAdmin, getAdmin);

export default router;