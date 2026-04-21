import express                 from "express";
import { rawBodyMiddleware }   from "../middleware/rawBodyMiddleware";
import {
  handleClerkWebhook,
  handlePaystackWebhook,
} from "../controllers/webhookControllers";

const router = express.Router();

// ── CLERK WEBHOOK ─────────────────────────────────────────
router.post("/clerk", rawBodyMiddleware, handleClerkWebhook);

// ── PAYSTACK WEBHOOK ──────────────────────────────────────
router.post("/paystack", rawBodyMiddleware, handlePaystackWebhook);

export default router;