import express                from "express";
import {
  getAllPayments,
  getPaymentByRef,
  getPlatformRevenue,
  overridePaymentStatus,
  recordCashPayment,
} from "../controllers/adminPaymentControllers";
import {
  getCommissionSummary,
  getCommissionByPeriod,
} from "../controllers/commissionControllers";
import { authMiddleware }     from "../middleware/authMiddleware";
import { requireAdmin }       from "../middleware/requireAdmin";

const router = express.Router();

// ── ALL ROUTES PROTECTED — ADMIN ONLY ────────────────────
router.use(authMiddleware(), requireAdmin);

// ── PAYMENTS ──────────────────────────────────────────────
router.get("/",                    getAllPayments);
router.get("/revenue",             getPlatformRevenue);
router.get("/:reference",          getPaymentByRef);
router.post("/override/:reference", overridePaymentStatus);
router.post("/cash",               recordCashPayment);

// ── COMMISSION ────────────────────────────────────────────
router.get("/commission/summary",  getCommissionSummary);
router.get("/commission/period",   getCommissionByPeriod);

export default router;