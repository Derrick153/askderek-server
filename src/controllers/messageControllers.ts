import { Request, Response }           from "express";
import { z }                           from "zod";
import { Prisma }                      from "@prisma/client";
import { prisma }                      from "../lib/prisma";
import { logUserEvent, logAdminEvent } from "../lib/auditService";

// ─────────────────────────────────────────────────────────────────────────────
//  messageControllers.ts
//
//  Protected messaging system for AskDerek.
//
//  Core rules enforced:
//    — All messages go through AskDerek — no direct contact ever allowed
//    — Phone numbers, emails, WhatsApp and Telegram links auto-filtered
//    — Messages are NEVER deleted — only redacted when needed
//    — Redacted messages keep their record — content masked from users
//    — Derek sees every message on the platform including redacted originals
//    — Identity always from JWT — never from req.body or req.query
//    — Only parties in the enquiry can message each other
//    — Admin role verified against database — JWT alone is not enough
//    — adminDbId verified against authenticated clerkId on every admin action
//    — Raw Prisma records never sent to client — explicit field selection only
// ─────────────────────────────────────────────────────────────────────────────

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

// Authenticated admin — returned from requireAdminAuth.
// Carries both identifiers so callers never need a second DB round trip.
interface AuthenticatedAdmin {
  clerkId: string;
  dbId:    number;
}

// Safe message shape returned to regular users.
// Internal moderation fields (redactedBy, redactReason, redactedAt) are
// deliberately excluded — those are admin-only fields.
interface SafeMessage {
  id:            number;
  enquiryId:     number;
  senderClerkId: string;
  content:       string;
  createdAt:     Date;
  isRedacted:    boolean;
}

// ── VALIDATION SCHEMAS ────────────────────────────────────────────────────────

const sendMessageSchema = z.object({
  enquiryId:      z.number({ error: "enquiryId must be a number" })
                   .int()
                   .positive("enquiryId must be a positive integer"),
  content:        z.string()
                   .min(1,    "Message cannot be empty")
                   .max(2000, "Message cannot exceed 2000 characters"),
  // Optional — when provided, duplicate messages on network retry are rejected.
  // Client must generate a UUID per send attempt and reuse it on retry.
  // Requires a unique index on Message.idempotencyKey in the Prisma schema.
  idempotencyKey: z.string()
                   .uuid("idempotencyKey must be a valid UUID")
                   .optional(),
});

const redactMessageSchema = z.object({
  redactReason: z.string()
                 .min(5,   "Redact reason must be at least 5 characters")
                 .max(500, "Redact reason cannot exceed 500 characters"),
  adminDbId:    z.number({ error: "adminDbId must be a number" })
                 .int()
                 .positive(),
});

const flagMessageSchema = z.object({
  adminDbId: z.number({ error: "adminDbId must be a number" })
              .int()
              .positive(),
  reason:    z.string()
              .min(5,   "Flag reason must be at least 5 characters")
              .max(500, "Flag reason cannot exceed 500 characters")
              .optional(),
});

// ── CONTACT INFO FILTER ───────────────────────────────────────────────────────
// Strips phone numbers, emails and external messaging links from messages.
// This is AskDerek's core protection — enforces all communication stays
// on the platform so Derek can see it and commission is always captured.
//
// Even if a landlord or buyer tries to share their number — it is removed
// before the message reaches the database. They never see each other's
// contact details unless Derek explicitly decides to share them.
//
// Covers:
//   — Ghana mobile numbers: 0XX format, +233 format
//   — Double-zero international prefix: 00233...
//   — Space/dash-separated Ghana numbers: 024 123 4567 / 024-123-4567
//   — International numbers with + prefix
//   — Email addresses
//   — WhatsApp links and keyword mentions
//   — Telegram links

const GHANA_PHONE_PATTERN       = /(\+?233|0)[2-9][0-9]{8}/g;
const DOUBLE_ZERO_PHONE_PATTERN = /\b00[1-9]\d{6,13}/g;
const SPACED_GHANA_PATTERN      = /0[2-9][0-9]\s?[0-9]{3}\s?[0-9]{4}/g;
const DASHED_GHANA_PATTERN      = /0[2-9][0-9]-[0-9]{3}-[0-9]{4}/g;
const INTL_PHONE_PATTERN        = /(\+[1-9]\d{6,14})/g;
const EMAIL_PATTERN             = /\S+@\S+\.\S+/g;
const WHATSAPP_PATTERN          = /whatsapp|wa\.me|chat\.whatsapp/gi;
const TELEGRAM_PATTERN          = /t\.me\/|telegram\.me\//gi;

const filterContactInfo = (text: string): string =>
  text
    .replace(GHANA_PHONE_PATTERN,       "[phone number removed]")
    .replace(DOUBLE_ZERO_PHONE_PATTERN, "[phone number removed]")
    .replace(SPACED_GHANA_PATTERN,      "[phone number removed]")
    .replace(DASHED_GHANA_PATTERN,      "[phone number removed]")
    .replace(INTL_PHONE_PATTERN,        "[phone number removed]")
    .replace(EMAIL_PATTERN,             "[email removed]")
    .replace(WHATSAPP_PATTERN,          "[external contact removed]")
    .replace(TELEGRAM_PATTERN,          "[external contact removed]");

// ── SHARED HELPERS ────────────────────────────────────────────────────────────

// Extracts userId from verified Clerk JWT.
// Identity must always come from the token — never from req.body or req.query.
const requireAuth = (req: Request, res: Response): string | null => {
  const userId = req.auth?.userId;
  if (!userId) {
    res.status(401).json({ success: false, message: "Unauthorized" });
    return null;
  }
  return userId;
};

// Verifies caller is an active admin via database check and returns both
// their clerkId and numeric DB id in a single query.
//
// JWT alone is not trusted for admin actions — role confirmed every request.
// Prevents demoted admins from continuing to act as admin.
//
// Returning dbId here eliminates the need for a second DB call to verify
// adminDbId from the request body — callers compare inline against admin.dbId.
const requireAdminAuth = async (
  req: Request,
  res: Response
): Promise<AuthenticatedAdmin | null> => {
  const userId = req.auth?.userId;
  if (!userId) {
    res.status(401).json({ success: false, message: "Unauthorized" });
    return null;
  }
  const user = await prisma.user.findUnique({
    where:  { clerkId: userId },
    select: { id: true, role: true, isActive: true },
  });
  if (!user || user.role !== "ADMIN" || !user.isActive) {
    res.status(403).json({ success: false, message: "Forbidden" });
    return null;
  }
  return { clerkId: userId, dbId: user.id };
};

// Converts Zod issues to standard API error shape.
const formatZodErrors = (
  issues: z.ZodIssue[]
): { field: string; message: string }[] =>
  issues.map(i => ({
    field:   String(i.path[0] ?? "unknown"),
    message: i.message,
  }));

// Validates a numeric route parameter.
const getNumericParam = (
  value: string,
  name:  string,
  res:   Response
): number | null => {
  const id = Number(value);
  if (isNaN(id) || id <= 0) {
    res.status(400).json({ success: false, message: `Invalid ${name}` });
    return null;
  }
  return id;
};

// Maps a DB message record to the safe user-facing shape.
// Masks redacted content and strips all internal moderation fields.
// Users never see redactedBy, redactReason, or redactedAt.
const toSafeMessage = (m: {
  id:            number;
  enquiryId:     number;
  senderClerkId: string;
  content:       string;
  createdAt:     Date;
  isRedacted:    boolean;
}): SafeMessage => ({
  id:            m.id,
  enquiryId:     m.enquiryId,
  senderClerkId: m.senderClerkId,
  content:       m.isRedacted ? "[This message was removed by AskDerek]" : m.content,
  createdAt:     m.createdAt,
  isRedacted:    m.isRedacted,
});

// ─────────────────────────────────────────────────────────────────────────────
//  SEND MESSAGE
//  POST /api/messages
//
//  Sends a message within an enquiry thread.
//  Only the buyer and manager on that specific enquiry can send.
//  Contact info filtered before saving — enforces no direct contact rule.
//  Cannot send on COMPLETED or LOST enquiries.
//  If content was filtered an audit log is created for Derek to review.
//  Enquiry updatedAt bumped atomically with message insert — drives inbox order.
//  Optional idempotencyKey (UUID) prevents duplicate messages on network retry.
//  Race-condition-safe: unique DB constraint catches concurrent duplicate sends.
// ─────────────────────────────────────────────────────────────────────────────
export const sendMessage = async (
  req: Request,
  res: Response<ApiResponse>
): Promise<void> => {
  const userId = requireAuth(req, res);
  if (!userId) return;

  const parsed = sendMessageSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      success: false,
      message: "Validation failed",
      errors:  formatZodErrors(parsed.error.issues),
    });
    return;
  }

  const { enquiryId, content, idempotencyKey } = parsed.data;

  try {
    // Authorization — verify sender is a party to this enquiry.
    // Only the buyer and manager who created the enquiry can message.
    const enquiry = await prisma.enquiry.findFirst({
      where: {
        id: enquiryId,
        OR: [
          { enquirerClerkId: userId },
          { managerClerkId:  userId },
        ],
      },
    });

    if (!enquiry) {
      res.status(404).json({
        success: false,
        message: "Enquiry not found or you are not a party to this conversation",
      });
      return;
    }

    // Status guard — no messages on closed enquiries.
    if (enquiry.status === "COMPLETED" || enquiry.status === "LOST") {
      res.status(400).json({
        success: false,
        message: "Cannot send messages on a completed or lost enquiry",
      });
      return;
    }

    // Filter contact info before saving.
    // This runs on every message — no exceptions.
    const filteredContent = filterContactInfo(content);
    const wasFiltered     = filteredContent !== content;

    // Atomic transaction — message created and enquiry updatedAt bumped together.
    // enquiry.updatedAt drives correct inbox sort order in getUserThreads.
    //
    // Idempotency is enforced via a unique DB constraint on idempotencyKey
    // rather than a pre-flight findFirst check. A pre-flight check has a race
    // condition — two concurrent retries both pass it and both insert.
    // The unique constraint makes the database the single authority.
    // P2002 violation is caught in the error handler below.
    const [newMessage] = await prisma.$transaction([
      prisma.message.create({
        data: {
          enquiryId,
          senderClerkId: userId,
          content:       filteredContent,
          ...(idempotencyKey ? { idempotencyKey } : {}),
        },
        select: {
          id:            true,
          enquiryId:     true,
          senderClerkId: true,
          content:       true,
          createdAt:     true,
          isRedacted:    true,
        },
      }),
      prisma.enquiry.update({
        where: { id: enquiryId },
        data:  { updatedAt: new Date() },
      }),
    ]);

    // Log when content was modified — creates audit trail for Derek.
    // Helps identify users repeatedly trying to bypass the platform rules.
    if (wasFiltered) {
      await logUserEvent({
        userClerkId: userId,
        action:      "MESSAGE_FILTERED",
        target:      `Message #${newMessage.id} in Enquiry #${enquiryId}`,
        details:     "Contact information was automatically removed from message",
      });
    }

    res.status(201).json({
      success: true,
      message: "Message sent successfully",
      data:    toSafeMessage(newMessage),
    });
  } catch (error) {
    // Idempotency — unique constraint violation on idempotencyKey means this
    // message was already delivered. Return the original rather than an error.
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002" &&
      idempotencyKey
    ) {
      const existing = await prisma.message.findFirst({
        where:  { idempotencyKey },
        select: {
          id:            true,
          enquiryId:     true,
          senderClerkId: true,
          content:       true,
          createdAt:     true,
          isRedacted:    true,
        },
      });
      if (existing) {
        res.status(200).json({
          success: true,
          message: "Message already sent",
          data:    toSafeMessage(existing),
        });
        return;
      }
    }

    console.error("[messageControllers.sendMessage]", {
      enquiryId,
      userId,
      error: error instanceof Error ? error.message : error,
    });
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
//  GET THREAD
//  GET /api/messages/thread/:enquiryId
//
//  Returns all messages in an enquiry thread in chronological order.
//  Only the buyer and manager on that enquiry can view the thread.
//  Redacted messages show a placeholder — original content hidden from users.
//  Internal moderation fields excluded from response — admin view only.
//  Admin uses getThreadAdmin to see original redacted content.
// ─────────────────────────────────────────────────────────────────────────────
export const getThread = async (
  req: Request,
  res: Response<ApiResponse>
): Promise<void> => {
  const userId = requireAuth(req, res);
  if (!userId) return;

  const enquiryId = getNumericParam(req.params.enquiryId, "enquiryId", res);
  if (!enquiryId) return;

  try {
    // Authorization — confirm caller is a party to this enquiry.
    const enquiry = await prisma.enquiry.findFirst({
      where: {
        id: enquiryId,
        OR: [
          { enquirerClerkId: userId },
          { managerClerkId:  userId },
        ],
      },
    });

    if (!enquiry) {
      res.status(404).json({
        success: false,
        message: "Enquiry not found or you are not a party to this conversation",
      });
      return;
    }

    const messages = await prisma.message.findMany({
      where:   { enquiryId },
      orderBy: { createdAt: "asc" },
      select: {
        id:            true,
        enquiryId:     true,
        senderClerkId: true,
        content:       true,
        createdAt:     true,
        isRedacted:    true,
        // redactedBy, redactReason, redactedAt intentionally excluded
      },
    });

    res.status(200).json({
      success: true,
      message: "Thread retrieved successfully",
      data:    messages.map(toSafeMessage),
    });
  } catch (error) {
    console.error("[messageControllers.getThread]", {
      enquiryId,
      userId,
      error: error instanceof Error ? error.message : error,
    });
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
//  GET USER THREADS (INBOX)
//  GET /api/messages/threads/my
//
//  Returns all enquiry threads the logged-in user is part of.
//  Includes latest message preview per thread — no N+1.
//  Powers the messages inbox on both buyer and manager dashboards.
//  Redacted preview messages show placeholder text.
//  Sorted by enquiry updatedAt descending — most recent activity first.
//  updatedAt is bumped by sendMessage on every new message.
// ─────────────────────────────────────────────────────────────────────────────
export const getUserThreads = async (
  req: Request,
  res: Response<ApiResponse>
): Promise<void> => {
  const userId = requireAuth(req, res);
  if (!userId) return;

  try {
    const enquiries = await prisma.enquiry.findMany({
      where: {
        isArchived: false,
        OR: [
          { enquirerClerkId: userId },
          { managerClerkId:  userId },
        ],
      },
      include: {
        property: {
          select: {
            id:            true,
            name:          true,
            listingType:   true,
            listingStatus: true,
          },
        },
        // Single latest message per thread — prevents N+1.
        // Internal moderation fields excluded from preview.
        messages: {
          orderBy: { createdAt: "desc" },
          take:    1,
          select: {
            content:       true,
            createdAt:     true,
            senderClerkId: true,
            isRedacted:    true,
          },
        },
      },
      // Sort by updatedAt — bumped on every new message by sendMessage.
      // Shows threads with most recent activity at the top of the inbox.
      orderBy: { updatedAt: "desc" },
    });

    const sanitized = enquiries.map(e => ({
      ...e,
      messages: e.messages.map(m => ({
        ...m,
        content: m.isRedacted
          ? "[This message was removed by AskDerek]"
          : m.content,
      })),
    }));

    res.status(200).json({
      success: true,
      message: "Threads retrieved successfully",
      data:    sanitized,
    });
  } catch (error) {
    console.error("[messageControllers.getUserThreads]", {
      userId,
      error: error instanceof Error ? error.message : error,
    });
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
//  GET ALL THREADS — ADMIN
//  GET /api/messages/admin/all
//
//  Returns all message threads platform wide — Derek only.
//  Paginated — prevents memory overload as platform scales.
//  Includes moderation summary — redacted count for quick review.
//  All three queries run in parallel — single database round trip.
//  isArchived visible in results so admin dashboard can differentiate.
// ─────────────────────────────────────────────────────────────────────────────
export const getAllThreads = async (
  req: Request,
  res: Response<ApiResponse>
): Promise<void> => {
  const admin = await requireAdminAuth(req, res);
  if (!admin) return;

  const page  = Math.max(1,  Number(req.query.page)  || 1);
  const limit = Math.min(50, Number(req.query.limit)  || 20);
  const skip  = (page - 1) * limit;

  try {
    // All three queries run in parallel — faster response than sequential.
    const [enquiries, redactedCount, total] = await Promise.all([
      prisma.enquiry.findMany({
        skip,
        take: limit,
        include: {
          property: {
            select: {
              id:          true,
              name:        true,
              listingType: true,
            },
          },
          messages: {
            orderBy: { createdAt: "desc" },
            take:    1,
          },
        },
        orderBy: { updatedAt: "desc" },
      }),
      prisma.message.count({ where: { isRedacted: true } }),
      prisma.enquiry.count(),
    ]);

    res.status(200).json({
      success: true,
      message: "All threads retrieved",
      data: {
        enquiries,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
        moderation: {
          totalThreads:  total,
          redactedCount,
        },
      },
    });
  } catch (error) {
    console.error("[messageControllers.getAllThreads]", {
      adminClerkId: admin.clerkId,
      error: error instanceof Error ? error.message : error,
    });
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
//  GET THREAD — ADMIN FULL VIEW
//  GET /api/messages/admin/thread/:enquiryId
//
//  Admin view of a full thread — Derek only.
//  Shows original content of redacted messages — not masked.
//  Includes all moderation fields: redactedBy, redactReason, redactedAt.
//  Used for moderation decisions and dispute resolution.
// ─────────────────────────────────────────────────────────────────────────────
export const getThreadAdmin = async (
  req: Request,
  res: Response<ApiResponse>
): Promise<void> => {
  const admin = await requireAdminAuth(req, res);
  if (!admin) return;

  const enquiryId = getNumericParam(req.params.enquiryId, "enquiryId", res);
  if (!enquiryId) return;

  try {
    const enquiry = await prisma.enquiry.findUnique({
      where:   { id: enquiryId },
      include: {
        // All message fields returned — admin sees original redacted content.
        messages: { orderBy: { createdAt: "asc" } },
        property: {
          select: {
            id:   true,
            name: true,
          },
        },
      },
    });

    if (!enquiry) {
      res.status(404).json({ success: false, message: "Enquiry not found" });
      return;
    }

    res.status(200).json({
      success: true,
      message: "Thread retrieved successfully",
      data:    enquiry,
    });
  } catch (error) {
    console.error("[messageControllers.getThreadAdmin]", {
      enquiryId,
      adminClerkId: admin.clerkId,
      error: error instanceof Error ? error.message : error,
    });
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
//  REDACT MESSAGE — ADMIN
//  PUT /api/messages/admin/redact/:messageId
//
//  Permanently masks a message that contains sensitive or harmful content.
//  Record is preserved — only the content is hidden from users.
//  Derek can still see the original in getThreadAdmin.
//  Requires a reason — creates accountability and audit trail.
//  Cannot redact an already redacted message.
//  adminDbId verified against authenticated clerkId — prevents audit spoofing.
// ─────────────────────────────────────────────────────────────────────────────
export const redactMessage = async (
  req: Request,
  res: Response<ApiResponse>
): Promise<void> => {
  const admin = await requireAdminAuth(req, res);
  if (!admin) return;

  const messageId = getNumericParam(req.params.messageId, "messageId", res);
  if (!messageId) return;

  const parsed = redactMessageSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      success: false,
      message: "Validation failed",
      errors:  formatZodErrors(parsed.error.issues),
    });
    return;
  }

  const { redactReason, adminDbId } = parsed.data;

  // Verify adminDbId from request body matches the authenticated admin.
  // requireAdminAuth already fetched the DB record — no extra query needed.
  // Prevents one admin from pinning audit log entries on another admin's id.
  if (adminDbId !== admin.dbId) {
    res.status(403).json({
      success: false,
      message: "adminDbId does not match authenticated user",
    });
    return;
  }

  try {
    const msg = await prisma.message.findUnique({
      where: { id: messageId },
    });

    if (!msg) {
      res.status(404).json({ success: false, message: "Message not found" });
      return;
    }

    if (msg.isRedacted) {
      res.status(400).json({
        success: false,
        message: "Message is already redacted",
      });
      return;
    }

    await prisma.message.update({
      where: { id: messageId },
      data: {
        isRedacted:   true,
        redactedAt:   new Date(),
        redactedBy:   admin.clerkId,
        redactReason,
      },
    });

    await logAdminEvent({
      adminId: admin.dbId,
      action:  "MESSAGE_REDACTED",
      target:  `Message #${messageId} in Enquiry #${msg.enquiryId}`,
      details: `Redacted by ${admin.clerkId}. Reason: ${redactReason}`,
    });

    res.status(200).json({
      success: true,
      message: "Message redacted successfully",
    });
  } catch (error) {
    console.error("[messageControllers.redactMessage]", {
      messageId,
      adminClerkId: admin.clerkId,
      error: error instanceof Error ? error.message : error,
    });
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
//  FLAG MESSAGE — ADMIN
//  PUT /api/messages/admin/flag/:messageId
//
//  Marks a message for review without redacting it immediately.
//  Used when a message looks suspicious but is not yet confirmed harmful.
//  Flagged messages appear in Derek's moderation queue for review.
//  Cannot flag an already redacted message.
//  Cannot flag an already flagged message — prevents reason being overwritten.
//  All flag values use "FLAGGED:" prefix — consistent so guard always catches it.
//  adminDbId verified against authenticated clerkId — prevents audit spoofing.
// ─────────────────────────────────────────────────────────────────────────────
export const flagMessage = async (
  req: Request,
  res: Response<ApiResponse>
): Promise<void> => {
  const admin = await requireAdminAuth(req, res);
  if (!admin) return;

  const messageId = getNumericParam(req.params.messageId, "messageId", res);
  if (!messageId) return;

  const parsed = flagMessageSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      success: false,
      message: "Validation failed",
      errors:  formatZodErrors(parsed.error.issues),
    });
    return;
  }

  const { adminDbId, reason } = parsed.data;

  // Verify adminDbId from request body matches the authenticated admin.
  // requireAdminAuth already fetched the DB record — no extra query needed.
  if (adminDbId !== admin.dbId) {
    res.status(403).json({
      success: false,
      message: "adminDbId does not match authenticated user",
    });
    return;
  }

  try {
    const msg = await prisma.message.findUnique({
      where: { id: messageId },
    });

    if (!msg) {
      res.status(404).json({ success: false, message: "Message not found" });
      return;
    }

    // No need to flag a message that is already redacted.
    if (msg.isRedacted) {
      res.status(400).json({
        success: false,
        message: "Message is already redacted — no need to flag",
      });
      return;
    }

    // Prevent overwriting an existing flag.
    // Both branches below use the "FLAGGED:" prefix so this guard catches both.
    if (msg.redactReason?.startsWith("FLAGGED:")) {
      res.status(400).json({
        success: false,
        message: "Message is already flagged for review",
      });
      return;
    }

    // Store flag in redactReason without setting isRedacted.
    // Marks it for Derek's review queue without hiding it from users yet.
    // Both branches use "FLAGGED:" prefix — consistent with the guard above.
    await prisma.message.update({
      where: { id: messageId },
      data: {
        redactReason: reason
          ? `FLAGGED: ${reason}`
          : `FLAGGED: review requested by ${admin.clerkId}`,
      },
    });

    await logAdminEvent({
      adminId: admin.dbId,
      action:  "MESSAGE_FLAGGED",
      target:  `Message #${messageId} in Enquiry #${msg.enquiryId}`,
      details: `Flagged by ${admin.clerkId}. Reason: ${reason ?? "No reason given"}`,
    });

    res.status(200).json({
      success: true,
      message: "Message flagged for review",
    });
  } catch (error) {
    console.error("[messageControllers.flagMessage]", {
      messageId,
      adminClerkId: admin.clerkId,
      error: error instanceof Error ? error.message : error,
    });
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};