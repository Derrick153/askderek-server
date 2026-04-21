import express                from "express";
import {
  initializePayment,
  verifyPayment,
  getPaymentsByLease,
  getTransactionsByTenant,
  getEarningsByManager,
  getPaymentStatus,
} from "../controllers/paymentControllers";
import { authMiddleware } from "../middleware/authMiddleware";

const router = express.Router();

// ── INITIALIZE PAYMENT 
router.post("/initialize", authMiddleware(), initializePayment);

// ── VERIFY PAYMENT ────────────────────────────────────────
router.get("/verify/:reference", authMiddleware(), verifyPayment);

// ── GET PAYMENT STATUS ────────────────────────────────────
router.get("/status/:reference", authMiddleware(), getPaymentStatus);

// ── GET PAYMENTS BY LEASE ─────────────────────────────────
router.get("/lease/:leaseId", authMiddleware(), getPaymentsByLease);

// ── GET TRANSACTIONS BY TENANT ────────────────────────────
router.get("/transactions/:tenantClerkId", authMiddleware(), getTransactionsByTenant);

// ── GET EARNINGS BY MANAGER ───────────────────────────────
router.get("/earnings/:managerClerkId", authMiddleware(), getEarningsByManager);

export default router;