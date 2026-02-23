import express from "express";
import {
  initializePayment,
  verifyPayment,
  paystackWebhook,
} from "../controllers/paymentController";

const router = express.Router();

// Initialize payment
router.post("/initialize", initializePayment);

// Verify payment
router.get("/verify/:reference", verifyPayment);

// Paystack webhook
router.post("/webhook", paystackWebhook);

export default router;