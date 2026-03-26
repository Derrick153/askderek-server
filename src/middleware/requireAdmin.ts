import { Request, Response, NextFunction } from "express";
import { prisma } from "../lib/prisma";

export const requireAdmin = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const clerkId = req.auth?.userId;

    if (!clerkId) {
      res.status(401).json({ message: "Unauthorized" });
      return;
    }

    const user = await prisma.user.findUnique({
      where: { clerkId },
    });

    if (!user) {
      res.status(401).json({ message: "User not found" });
      return;
    }

    if (user.role !== "ADMIN") {
      res.status(403).json({ message: "Forbidden - Admin access required" });
      return;
    }

    next();
  } catch (error) {
    console.error("Admin middleware error:", error);
    res.status(500).json({ message: "Server error" });
  }
};