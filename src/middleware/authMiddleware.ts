import { Request, Response, NextFunction, RequestHandler } from "express";
import { ClerkExpressRequireAuth } from "@clerk/clerk-sdk-node";
import { prisma } from "../lib/prisma";

declare global {
  namespace Express {
    interface Request {
      auth?: {
        userId: string;
        sessionId: string;
        orgId?: string;
      };
      user?: {
        id: string;
        role?: string;
      };
    }
  }
}

export const authMiddleware = (allowedRoles?: string[]): RequestHandler => {
  return (req: Request, res: Response, next: NextFunction): any => {
    const clerkMiddleware = ClerkExpressRequireAuth() as any;

    clerkMiddleware(req, res, async (err?: any) => {
      if (err) {
        return res.status(401).json({ message: "Unauthorized" });
      }

      if (!req.auth?.userId) {
        return res.status(401).json({ message: "Unauthorized - No user ID" });
      }

      try {
        // ✅ Get role from DATABASE not Clerk metadata
        const user = await prisma.user.findUnique({
          where: { clerkId: req.auth.userId },
        });

        req.user = {
          id: req.auth.userId,
          role: user?.role || "TENANT",
        };

        // ✅ Check role if allowedRoles specified
        if (allowedRoles && allowedRoles.length > 0) {
          if (!user || !allowedRoles.includes(user.role)) {
            return res.status(403).json({ message: "Forbidden - Insufficient permissions" });
          }
        }

        next();
      } catch (error) {
        console.error("Auth middleware error:", error);
        return res.status(500).json({ message: "Server error" });
      }
    });
  };
};

export const requireTenant: RequestHandler = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<any> => {
  try {
    if (!req.auth?.userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const user = await prisma.user.findUnique({
      where: { clerkId: req.auth.userId },
    });

    if (!user) {
      return res.status(401).json({ message: "User not found" });
    }

    if (user.role !== "TENANT" && user.role !== "ADMIN") {
      return res.status(403).json({ message: "Forbidden - Tenant access required" });
    }

    next();
  } catch (error) {
    return res.status(500).json({ message: "Server error" });
  }
};

export const requireManager: RequestHandler = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<any> => {
  try {
    if (!req.auth?.userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const user = await prisma.user.findUnique({
      where: { clerkId: req.auth.userId },
    });

    if (!user) {
      return res.status(401).json({ message: "User not found" });
    }

    if (user.role !== "MANAGER" && user.role !== "ADMIN") {
      return res.status(403).json({ message: "Forbidden - Manager access required" });
    }

    next();
  } catch (error) {
    return res.status(500).json({ message: "Server error" });
  }
};