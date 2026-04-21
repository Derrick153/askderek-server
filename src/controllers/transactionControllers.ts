import { Request, Response } from "express";
import { prisma }            from "../lib/prisma";

// ─────────────────────────────────────────────────────────────────────────────
//  transactionControllers.ts
//
//  Full transaction history and logs.
//  Called by tenant dashboard, landlord dashboard and admin panel.
// ─────────────────────────────────────────────────────────────────────────────

// ── GET TRANSACTIONS BY TENANT ────────────────────────────
export const getTransactionsByTenant = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { tenantClerkId } = req.params;

    const transactions = await prisma.transaction.findMany({
      where:   { tenantClerkId },
      include: {
        lease: {
          include: {
            property: {
              include: { location: true },
            },
          },
        },
        payment:    true,
        commission: true,
      },
      orderBy: { createdAt: "desc" },
    });

    res.status(200).json(transactions);
  } catch (error: any) {
    res.status(500).json({ message: `Error fetching transactions: ${error.message}` });
  }
};

// ── GET TRANSACTIONS BY LEASE ─────────────────────────────
export const getTransactionsByLease = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { leaseId } = req.params;

    const transactions = await prisma.transaction.findMany({
      where:   { leaseId: Number(leaseId) },
      include: { payment: true, commission: true },
      orderBy: { createdAt: "desc" },
    });

    res.status(200).json(transactions);
  } catch (error: any) {
    res.status(500).json({ message: `Error fetching transactions: ${error.message}` });
  }
};

// ── GET TRANSACTION BY REFERENCE ──────────────────────────
export const getTransactionByReference = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { reference } = req.params;

    const transaction = await prisma.transaction.findFirst({
      where:   { paystackReference: reference },
      include: {
        payment:    true,
        commission: true,
        lease: {
          include: {
            property: { include: { location: true } },
            tenant:   { include: { user: true } },
          },
        },
      },
    });

    if (!transaction) {
      res.status(404).json({ message: "Transaction not found" });
      return;
    }

    res.status(200).json(transaction);
  } catch (error: any) {
    res.status(500).json({ message: `Error fetching transaction: ${error.message}` });
  }
};

// ── GET ALL TRANSACTIONS — ADMIN ──────────────────────────
export const getAllTransactions = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const page  = Number(req.query.page)  || 1;
    const limit = Number(req.query.limit) || 20;
    const skip  = (page - 1) * limit;

    const [transactions, total] = await Promise.all([
      prisma.transaction.findMany({
        include: {
          payment:    true,
          commission: true,
          lease: {
            include: {
              property: { include: { location: true } },
              tenant:   { include: { user: true } },
            },
          },
        },
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
      prisma.transaction.count(),
    ]);

    res.status(200).json({
      transactions,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error: any) {
    res.status(500).json({ message: `Error fetching transactions: ${error.message}` });
  }
};