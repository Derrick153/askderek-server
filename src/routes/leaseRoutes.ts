import { Router } from "express";
import {
  getLeases,
  getLeasePayments,
} from "../controllers/leaseControllers";

const router = Router();

// Get all leases
router.get("/", getLeases);

// Get payments for a specific lease
router.get("/:id/payments", getLeasePayments);

export default router;