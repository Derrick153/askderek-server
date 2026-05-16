// ─────────────────────────────────────────────────────────────────────────────
//  messageRoutes.ts
//
//  Protected messaging routes for AskDerek.
//
//  Three access levels:
//    User    — sends messages and views their own threads
//    Admin   — views all threads and can redact or flag messages
//
//  ROUTE ORDER IS CRITICAL:
//    Static routes must come BEFORE dynamic routes.
//    /threads/my and /admin/all must be registered before
//    /thread/:enquiryId or Express will match "my" and "admin"
//    as enquiryId param values — causing wrong controller to fire.
//
//  clerkMiddleware() is registered globally in index.ts.
//  Role and ownership checks are enforced inside each controller.
// ─────────────────────────────────────────────────────────────────────────────

import { Router }      from "express";
import rateLimit       from "express-rate-limit";
import { requireAuth } from "@clerk/express";
import {
  sendMessage,
  getThread,
  getUserThreads,
  getAllThreads,
  getThreadAdmin,
  redactMessage,
  flagMessage,
} from "../controllers/messageControllers";

const router = Router();

// ── RATE LIMITERS ─────────────────────────────────────────────────────────────

// Message sending — max 20 per minute per IP
// Allows normal conversation flow while blocking spam
const sendMessageLimiter = rateLimit({
  windowMs:        60 * 1000,
  max:             20,
  standardHeaders: true,
  legacyHeaders:   false,
  message:         { success: false, message: "Sending too fast. Please slow down." },
});

// General read and update actions
const generalLimiter = rateLimit({
  windowMs:        15 * 60 * 1000,
  max:             100,
  standardHeaders: true,
  legacyHeaders:   false,
  message:         { success: false, message: "Too many requests. Please slow down." },
});

// Admin moderation actions — slightly more restricted
const adminLimiter = rateLimit({
  windowMs:        15 * 60 * 1000,
  max:             50,
  standardHeaders: true,
  legacyHeaders:   false,
  message:         { success: false, message: "Too many requests. Please slow down." },
});

// ── STATIC ROUTES — registered before dynamic ─────────────────────────────────

// User inbox — all threads the logged-in user is part of
router.get("/threads/my", generalLimiter, getUserThreads);

// Admin — all threads platform wide with pagination and moderation summary
router.get("/admin/all",               requireAuth(), adminLimiter,      getAllThreads);

// Admin — full thread including original redacted message content
router.get("/admin/thread/:enquiryId", requireAuth(), adminLimiter,      getThreadAdmin);

// Send a new message inside an enquiry thread
router.post("/",                       requireAuth(), sendMessageLimiter, sendMessage);

// ── DYNAMIC ROUTES — registered after static ──────────────────────────────────

// Get full thread by enquiry ID — buyer and manager only
router.get("/thread/:enquiryId",       requireAuth(), generalLimiter,    getThread);

// ── ADMIN MODERATION ROUTES ───────────────────────────────────────────────────

// Redact message — masks content permanently — record preserved
router.put("/admin/redact/:messageId", requireAuth(), adminLimiter,      redactMessage);

// Flag message for review — does not hide content yet
router.put("/admin/flag/:messageId",   requireAuth(), adminLimiter,      flagMessage);

export default router;