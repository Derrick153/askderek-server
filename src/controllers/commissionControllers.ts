import { Request, Response } from "express";
import { prisma }            from "../lib/prisma";
import { formatGHS }         from "../lib/paymentUtils";

// ─────────────────────────────────────────────────────────────────────────────
//  commissionControllers.ts
//
//  Tracks Derek's 5% commission on every successful payment.
//  Used by admin dashboard to see platform revenue.
// ─────────────────────────────────────────────────────────────────────────────

// ── GET COMMISSION SUMMARY — ADMIN ────────────────────────
export const getCommissionSummary = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const commissions = await prisma.commission.findMany({
      include: {
        transaction: {
          include: {
            lease: {
              include: {
                property: {
                  include: { location: true },
                },
              },
            },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    const totalGross      = commissions.reduce((s, c) => s + c.grossAmount,      0);
    const totalCommission = commissions.reduce((s, c) => s + c.commissionAmount, 0);
    const totalNet        = commissions.reduce((s, c) => s + c.netAmount,        0);

    res.status(200).json({
      summary: {
        totalGross:           formatGHS(totalGross),
        totalCommission:      formatGHS(totalCommission),
        totalNet:             formatGHS(totalNet),
        totalTransactions:    commissions.length,
        averageCommission:    commissions.length > 0
          ? formatGHS(totalCommission / commissions.length)
          : formatGHS(0),
      },
      commissions,
    });
  } catch (error: any) {
    res.status(500).json({ message: `Error fetching commission summary: ${error.message}` });
  }
};

// ── GET COMMISSION BY PERIOD ──────────────────────────────
export const getCommissionByPeriod = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { from, to } = req.query;

    const where: any = {};
    if (from || to) {
      where.createdAt = {};
      if (from) where.createdAt.gte = new Date(from as string);
      if (to)   where.createdAt.lte = new Date(to   as string);
    }

    const commissions = await prisma.commission.findMany({
      where,
      include: {
        transaction: {
          include: {
            lease: {
              include: {
                property: { include: { location: true } },
              },
            },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    const totalCommission = commissions.reduce((s, c) => s + c.commissionAmount, 0);
    const totalGross      = commissions.reduce((s, c) => s + c.grossAmount,      0);

    res.status(200).json({
      period: { from: from ?? "all time", to: to ?? "now" },
      summary: {
        totalCommission: formatGHS(totalCommission),
        totalGross:      formatGHS(totalGross),
        totalPayments:   commissions.length,
      },
      commissions,
    });
  } catch (error: any) {
    res.status(500).json({ message: `Error fetching commission by period: ${error.message}` });
  }
};

// ── GET COMMISSION BY MANAGER ─────────────────────────────
export const getCommissionByManager = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { managerClerkId } = req.params;

    const commissions = await prisma.commission.findMany({
      where:   { managerClerkId },
      include: {
        transaction: {
          include: {
            lease: {
              include: {
                property: { include: { location: true } },
              },
            },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    const totalGross      = commissions.reduce((s, c) => s + c.grossAmount,      0);
    const totalCommission = commissions.reduce((s, c) => s + c.commissionAmount, 0);
    const totalNet        = commissions.reduce((s, c) => s + c.netAmount,        0);

    res.status(200).json({
      managerClerkId,
      summary: {
        totalGross:      formatGHS(totalGross),
        totalCommission: formatGHS(totalCommission),
        totalNet:        formatGHS(totalNet),
        totalPayments:   commissions.length,
      },
      commissions,
    });
  } catch (error: any) {
    res.status(500).json({ message: `Error fetching manager commission: ${error.message}` });
  }
};