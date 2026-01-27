import { Request, Response, NextFunction, RequestHandler } from "express";
import { ClerkExpressRequireAuth } from "@clerk/clerk-sdk-node";

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
      };
    }
  }
}

export const authMiddleware = (allowedRoles?: string[]): RequestHandler => {
  return (req: Request, res: Response, next: NextFunction): any => {
    const clerkMiddleware = ClerkExpressRequireAuth() as any;
    
    clerkMiddleware(req, res, (err?: any) => {
      if (err) {
        return res.status(401).json({ message: "Unauthorized" });
      }

      if (!req.auth?.userId) {
        return res.status(401).json({ message: "Unauthorized - No user ID" });
      }

      req.user = {
        id: req.auth.userId,
      };

      next();
    });
  };
};

export const requireTenant: RequestHandler = (req: Request, res: Response, next: NextFunction): any => {
  if (!req.auth?.userId) {
    return res.status(401).json({ message: "Unauthorized" });
  }
  next();
};

export const requireManager: RequestHandler = (req: Request, res: Response, next: NextFunction): any => {
  if (!req.auth?.userId) {
    return res.status(401).json({ message: "Unauthorized" });
  }
  next();
};