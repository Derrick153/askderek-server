import { Request, Response } from "express";
import { prisma } from "../lib/prisma";

// ── REGISTER USER ─────────────────────────────────────────
export const registerUser = async (req: Request, res: Response): Promise<void> => {
  try {
    const { clerkId, name, email, phoneNumber, role } = req.body;

    if (!clerkId || !name || !email) {
      res.status(400).json({ message: "clerkId, name and email are required" });
      return;
    }

    const validRoles = ["TENANT", "MANAGER", "ADMIN"];
    const userRole = validRoles.includes(role?.toUpperCase())
      ? role.toUpperCase()
      : "TENANT";

    // ✅ Create or update User
    const user = await prisma.user.upsert({
      where: { clerkId },
      update: { name, email, phoneNumber, role: userRole },
      create: { clerkId, name, email, phoneNumber: phoneNumber || "", role: userRole },
    });

    // ✅ Create profile based on role
    if (userRole === "TENANT") {
      const existing = await prisma.tenant.findUnique({ where: { userId: user.id } });
      if (!existing) {
        await prisma.tenant.create({
          data: { clerkId, userId: user.id, phoneNumber: phoneNumber || "" },
        });
      }
    }

    if (userRole === "MANAGER") {
      const existing = await prisma.manager.findUnique({ where: { userId: user.id } });
      if (!existing) {
        await prisma.manager.create({
          data: { clerkId, userId: user.id },
        });
      }
    }

    console.log(`✅ User registered: ${user.name} (${user.role})`);
    res.status(201).json(user);
  } catch (error: any) {
    console.error("❌ Register error:", error.message);
    res.status(500).json({ message: `Error registering user: ${error.message}` });
  }
};

// ── GET CURRENT USER ──────────────────────────────────────
export const getMe = async (req: Request, res: Response): Promise<void> => {
  try {
    const clerkId = req.auth?.userId;

    if (!clerkId) {
      res.status(401).json({ message: "Unauthorized" });
      return;
    }

    const user = await prisma.user.findUnique({
      where: { clerkId },
      include: {
        manager: true,
        tenant: true,
      },
    });

    if (!user) {
      res.status(404).json({ message: "User not found" });
      return;
    }

    res.json(user);
  } catch (error: any) {
    res.status(500).json({ message: `Error getting user: ${error.message}` });
  }
};