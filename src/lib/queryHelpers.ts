// ─────────────────────────────────────────────────────────────────────────────
//  queryHelpers.ts
//
//  Reusable Prisma query filters for AskDerek.
//
//  These helpers prevent filter logic from being duplicated
//  across controllers. Every controller that queries properties
//  or leases uses these helpers to ensure consistent behaviour.
//
//  Exports:
//    activePropertyFilter  — excludes deleted and archived properties
//    activeLeaseFilter     — excludes expired and frozen leases
//    generateAuditHash     — creates a tamper-evident SHA-256 hash
//    generateRestoreCode   — creates a unique restore reference
//    getPagination         — extracts safe page and limit from query
//    buildPaginationMeta   — builds consistent pagination response shape
// ─────────────────────────────────────────────────────────────────────────────

import crypto                        from "crypto";
import { ListingStatus }             from "@prisma/client";

// ── ACTIVE PROPERTY FILTER ────────────────────────────────────────────────────
//
//  Excludes soft deleted, archived and pending removal properties.
//  Use in any query that should only return publicly visible properties.
//
//  Example:
//    const properties = await prisma.property.findMany({
//      where: { ...activePropertyFilter, locationId: 5 },
//    });

export const activePropertyFilter = {
  deletedAt:     null,
  isArchived:    false,
  listingStatus: { not: ListingStatus.PENDING_REMOVAL },
} as const;

// ── ACTIVE LEASE FILTER ───────────────────────────────────────────────────────
//
//  Excludes expired and frozen leases.
//  Use in any query that should only return currently valid leases.
//
//  Example:
//    const leases = await prisma.lease.findMany({
//      where: { ...activeLeaseFilter, propertyId: 10 },
//    });

export const activeLeaseFilter = {
  status:   "ACTIVE"  as const,
  isFrozen: false,
} as const;

// ── GENERATE AUDIT HASH ───────────────────────────────────────────────────────
//
//  Creates a tamper-evident SHA-256 hash for an audit log entry.
//  Pass the exact timestamp that will be stored on the record
//  so the hash can be independently verified later.
//
//  Example:
//    const now  = new Date().toISOString();
//    const hash = generateAuditHash({
//      action:    "PAYMENT_RECEIVED",
//      target:    "Payment #123",
//      details:   "GHS 700 paid by user_abc",
//      timestamp: now,
//    });

export const generateAuditHash = (entry: {
  action:     string;
  target:     string;
  details?:   string | null;
  timestamp:  string;
}): string => {
  const raw = `${entry.action}|${entry.target}|${entry.details ?? ""}|${entry.timestamp}`;
  return crypto.createHash("sha256").update(raw).digest("hex");
};

// ── GENERATE RESTORE CODE ─────────────────────────────────────────────────────
//
//  Generates a unique restore reference for soft-deleted properties.
//  Format: RST-YYYY-XXXXXXXX
//
//  Example:
//    const code = generateRestoreCode();
//    // returns "RST-2026-A3F7C2B1"

export const generateRestoreCode = (): string => {
  const year = new Date().getFullYear();
  const hex  = crypto.randomBytes(4).toString("hex").toUpperCase();
  return `RST-${year}-${hex}`;
};

// ── GET PAGINATION ────────────────────────────────────────────────────────────
//
//  Extracts and validates pagination parameters from query string.
//  Prevents negative pages and excessively large page sizes.
//  Maximum limit is 50 — prevents memory overload.
//
//  Example:
//    const { skip, take, page, limit } = getPagination(req.query);
//    const results = await prisma.property.findMany({ skip, take });

export const getPagination = (query: {
  page?:  unknown;
  limit?: unknown;
}): {
  page:  number;
  limit: number;
  skip:  number;
  take:  number;
} => {
  const page  = Math.max(1,  Number(query.page)  || 1);
  const limit = Math.min(50, Number(query.limit)  || 20);
  const skip  = (page - 1) * limit;
  return { page, limit, skip, take: limit };
};

// ── BUILD PAGINATION META ─────────────────────────────────────────────────────
//
//  Builds the standard pagination metadata for API responses.
//  Keeps pagination shape consistent across all list endpoints.
//
//  Example:
//    const pagination = buildPaginationMeta({ page, limit, total });
//    res.json({ success: true, data: { items, pagination } });

export const buildPaginationMeta = (params: {
  page:  number;
  limit: number;
  total: number;
}): {
  page:       number;
  limit:      number;
  total:      number;
  totalPages: number;
} => ({
  page:       params.page,
  limit:      params.limit,
  total:      params.total,
  totalPages: Math.ceil(params.total / params.limit),
});