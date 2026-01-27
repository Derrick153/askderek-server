// server/src/routes/webhookRoutes.ts
import express from "express";
import { handleClerkWebhook } from "../controllers/webhookControllers";

const router = express.Router();

/**
 * Clerk Webhook Endpoint
 * POST /api/webhooks/clerk
 * 
 * This endpoint receives events from Clerk when:
 * - Users sign up (user.created)
 * - Users update profile (user.updated)
 * - Users delete account (user.deleted)
 */
router.post("/clerk", express.raw({ type: "application/json" }), handleClerkWebhook);

export default router;