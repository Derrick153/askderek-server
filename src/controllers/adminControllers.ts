import { Request, Response } from "express";
import { prisma } from "../lib/prisma";

// ── HELPER: Create Audit Log ──────────────────────────────
const createAuditLog = async (
  adminClerkId: string,
  action: string,
  target: string,
  details?: string
) => {
  try {
    const admin = await prisma.user.findUnique({ where: { clerkId: adminClerkId } });
    if (admin) {
      await prisma.auditLog.create({
        data: { adminId: admin.id, action, target, details },
      });
    }
  } catch (error) {
    console.error("Failed to create audit log:", error);
  }
};

// ── ADMIN AUTH ────────────────────────────────────────────
export const createAdmin = async (req: Request, res: Response) => {
  try {
    const { clerkId, name, email } = req.body;
    if (!clerkId || !name || !email)
      return res.status(400).json({ message: "clerkId, name and email are required" });

    const existing = await prisma.user.findUnique({ where: { clerkId } });
    if (existing && existing.role === "ADMIN") return res.status(200).json(existing);

    const admin = await prisma.user.upsert({
      where: { clerkId },
      update: { role: "ADMIN" },
      create: { clerkId, name, email, role: "ADMIN" },
    });

    res.status(201).json(admin);
  } catch (error: any) {
    res.status(500).json({ message: "Failed to create admin", error: error.message });
  }
};

export const getAdmin = async (req: Request, res: Response) => {
  try {
    const { clerkId } = req.params;
    const admin = await prisma.user.findUnique({ where: { clerkId } });
    if (!admin || admin.role !== "ADMIN")
      return res.status(404).json({ message: "Admin not found" });
    res.status(200).json(admin);
  } catch (error: any) {
    res.status(500).json({ message: "Failed to get admin", error: error.message });
  }
};

// ── DASHBOARD ─────────────────────────────────────────────
export const getDashboardStats = async (req: Request, res: Response) => {
  try {
    const [
      totalProperties,
      pendingProperties,
      approvedProperties,
      totalManagers,
      verifiedManagers,
      pendingVerifications,
      totalTenants,
      totalApplications,
      pendingApplications,
      totalReports,
      unresolvedReports,
      totalPayments,
    ] = await Promise.all([
      prisma.property.count(),
      prisma.property.count({ where: { status: "Pending" } }),
      prisma.property.count({ where: { status: "Approved" } }),
      prisma.manager.count(),
      prisma.manager.count({ where: { isVerified: true } }),
      prisma.landlordVerification.count({ where: { status: "Pending" } }),
      prisma.tenant.count(),
      prisma.application.count(),
      prisma.application.count({ where: { status: "Pending" } }),
      prisma.report.count(),
      prisma.report.count({ where: { isResolved: false } }),
      prisma.payment.aggregate({ _sum: { amountPaid: true } }),
    ]);

    res.status(200).json({
      properties: {
        total: totalProperties,
        pending: pendingProperties,
        approved: approvedProperties,
        rejected: totalProperties - pendingProperties - approvedProperties,
      },
      managers: {
        total: totalManagers,
        verified: verifiedManagers,
        unverified: totalManagers - verifiedManagers,
        pendingVerifications,
      },
      tenants: { total: totalTenants },
      applications: { total: totalApplications, pending: pendingApplications },
      reports: { total: totalReports, unresolved: unresolvedReports },
      revenue: { total: totalPayments._sum.amountPaid || 0 },
    });
  } catch (error: any) {
    res.status(500).json({ message: "Failed to get dashboard stats", error: error.message });
  }
};

// ── PROPERTY MODERATION ───────────────────────────────────
export const getAllProperties = async (req: Request, res: Response) => {
  try {
    const properties = await prisma.property.findMany({
      include: {
        manager: { include: { user: true } },
        location: true,
        reports: true,
      },
      orderBy: { postedDate: "desc" },
    });
    res.status(200).json(properties);
  } catch (error: any) {
    res.status(500).json({ message: "Failed to get properties", error: error.message });
  }
};

export const getPendingProperties = async (req: Request, res: Response) => {
  try {
    const properties = await prisma.property.findMany({
      where: { status: "Pending" },
      include: {
        manager: { include: { user: true } },
        location: true,
      },
      orderBy: { postedDate: "desc" },
    });
    res.status(200).json(properties);
  } catch (error: any) {
    res.status(500).json({ message: "Failed to get pending properties", error: error.message });
  }
};

export const approveProperty = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const adminClerkId = req.auth?.userId;
    if (!adminClerkId) return res.status(401).json({ message: "Unauthorized" });

    const property = await prisma.property.update({
      where: { id: Number(id) },
      data: { status: "Approved" },
    });

    await createAuditLog(adminClerkId, "APPROVE_PROPERTY", `Property #${id}`, `Property "${property.name}" approved`);
    res.status(200).json({ message: "Property approved successfully", property });
  } catch (error: any) {
    res.status(500).json({ message: "Failed to approve property", error: error.message });
  }
};

export const rejectProperty = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;
    const adminClerkId = req.auth?.userId;
    if (!adminClerkId) return res.status(401).json({ message: "Unauthorized" });

    const property = await prisma.property.update({
      where: { id: Number(id) },
      data: { status: "Rejected" },
    });

    await createAuditLog(adminClerkId, "REJECT_PROPERTY", `Property #${id}`, `Property "${property.name}" rejected. Reason: ${reason}`);
    res.status(200).json({ message: "Property rejected successfully", property });
  } catch (error: any) {
    res.status(500).json({ message: "Failed to reject property", error: error.message });
  }
};

// ── LANDLORD VERIFICATION ─────────────────────────────────
export const getPendingVerifications = async (req: Request, res: Response) => {
  try {
    const verifications = await prisma.landlordVerification.findMany({
      where: { status: "Pending" },
      include: { manager: { include: { user: true } } },
      orderBy: { submittedAt: "desc" },
    });
    res.status(200).json(verifications);
  } catch (error: any) {
    res.status(500).json({ message: "Failed to get verifications", error: error.message });
  }
};

export const approveVerification = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const adminClerkId = req.auth?.userId;
    if (!adminClerkId) return res.status(401).json({ message: "Unauthorized" });

    const admin = await prisma.user.findUnique({ where: { clerkId: adminClerkId } });

    const verification = await prisma.landlordVerification.update({
      where: { id: Number(id) },
      data: {
        status: "Approved",
        reviewedAt: new Date(),
        reviewedByAdminId: admin?.id,
      },
    });

    await prisma.manager.update({
      where: { clerkId: verification.managerClerkId },
      data: { isVerified: true },
    });

    await createAuditLog(adminClerkId, "APPROVE_VERIFICATION", `Verification #${id}`, `Landlord ${verification.managerClerkId} verified`);
    res.status(200).json({ message: "Landlord verified successfully", verification });
  } catch (error: any) {
    res.status(500).json({ message: "Failed to approve verification", error: error.message });
  }
};

export const rejectVerification = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;
    const adminClerkId = req.auth?.userId;
    if (!adminClerkId) return res.status(401).json({ message: "Unauthorized" });

    const admin = await prisma.user.findUnique({ where: { clerkId: adminClerkId } });

    const verification = await prisma.landlordVerification.update({
      where: { id: Number(id) },
      data: {
        status: "Rejected",
        rejectionReason: reason,
        reviewedAt: new Date(),
        reviewedByAdminId: admin?.id,
      },
    });

    await createAuditLog(adminClerkId, "REJECT_VERIFICATION", `Verification #${id}`, `Landlord ${verification.managerClerkId} rejected. Reason: ${reason}`);
    res.status(200).json({ message: "Verification rejected", verification });
  } catch (error: any) {
    res.status(500).json({ message: "Failed to reject verification", error: error.message });
  }
};

// ── USER MANAGEMENT ───────────────────────────────────────
export const getAllManagers = async (req: Request, res: Response) => {
  try {
    const managers = await prisma.manager.findMany({
      include: {
        user: true,
        managedProperties: true,
        verification: true,
      },
      orderBy: { id: "desc" },
    });
    res.status(200).json(managers);
  } catch (error: any) {
    res.status(500).json({ message: "Failed to get managers", error: error.message });
  }
};

export const getAllTenants = async (req: Request, res: Response) => {
  try {
    const tenants = await prisma.tenant.findMany({
      include: {
        user: true,
        applications: true,
        leases: true,
      },
      orderBy: { id: "desc" },
    });
    res.status(200).json(tenants);
  } catch (error: any) {
    res.status(500).json({ message: "Failed to get tenants", error: error.message });
  }
};

// ── BLACKLIST ─────────────────────────────────────────────
export const getBlacklist = async (req: Request, res: Response) => {
  try {
    const blacklist = await prisma.blacklist.findMany({
      orderBy: { createdAt: "desc" },
    });
    res.status(200).json(blacklist);
  } catch (error: any) {
    res.status(500).json({ message: "Failed to get blacklist", error: error.message });
  }
};

export const addToBlacklist = async (req: Request, res: Response) => {
  try {
    const { phoneNumber, email, ghanaCardId, reason } = req.body;
    const adminClerkId = req.auth?.userId;
    if (!adminClerkId) return res.status(401).json({ message: "Unauthorized" });

    const admin = await prisma.user.findUnique({ where: { clerkId: adminClerkId } });
    if (!admin) return res.status(404).json({ message: "Admin not found" });

    const entry = await prisma.blacklist.create({
      data: { phoneNumber, email, ghanaCardId, reason, createdBy: admin.id },
    });

    await createAuditLog(adminClerkId, "ADD_BLACKLIST", `Blacklist #${entry.id}`, `Added to blacklist. Reason: ${reason}`);
    res.status(201).json({ message: "Added to blacklist", entry });
  } catch (error: any) {
    res.status(500).json({ message: "Failed to add to blacklist", error: error.message });
  }
};

export const removeFromBlacklist = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const adminClerkId = req.auth?.userId;
    if (!adminClerkId) return res.status(401).json({ message: "Unauthorized" });

    await prisma.blacklist.delete({ where: { id: Number(id) } });
    await createAuditLog(adminClerkId, "REMOVE_BLACKLIST", `Blacklist #${id}`, `Removed from blacklist`);

    res.status(200).json({ message: "Removed from blacklist" });
  } catch (error: any) {
    res.status(500).json({ message: "Failed to remove from blacklist", error: error.message });
  }
};

// ── REPORTS ───────────────────────────────────────────────
export const getAllReports = async (req: Request, res: Response) => {
  try {
    const reports = await prisma.report.findMany({
      include: { property: true },
      orderBy: { createdAt: "desc" },
    });
    res.status(200).json(reports);
  } catch (error: any) {
    res.status(500).json({ message: "Failed to get reports", error: error.message });
  }
};

export const resolveReport = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const adminClerkId = req.auth?.userId;
    if (!adminClerkId) return res.status(401).json({ message: "Unauthorized" });

    const admin = await prisma.user.findUnique({ where: { clerkId: adminClerkId } });

    const report = await prisma.report.update({
      where: { id: Number(id) },
      data: { isResolved: true, resolvedAt: new Date(), resolvedBy: admin?.id },
    });

    await createAuditLog(adminClerkId, "RESOLVE_REPORT", `Report #${id}`, `Report resolved`);
    res.status(200).json({ message: "Report resolved", report });
  } catch (error: any) {
    res.status(500).json({ message: "Failed to resolve report", error: error.message });
  }
};

// ── AUDIT LOGS ────────────────────────────────────────────
export const getAuditLogs = async (req: Request, res: Response) => {
  try {
    const logs = await prisma.auditLog.findMany({
      include: { admin: true },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    res.status(200).json(logs);
  } catch (error: any) {
    res.status(500).json({ message: "Failed to get audit logs", error: error.message });
  }
};

// ── ADMIN MANAGEMENT ──────────────────────────────────────
export const deleteAdmin = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const adminClerkId = req.auth?.userId;
    if (!adminClerkId) return res.status(401).json({ message: "Unauthorized" });

    const currentAdmin = await prisma.user.findUnique({ where: { clerkId: adminClerkId } });
    if (currentAdmin?.id === parseInt(id)) {
      return res.status(400).json({ message: "Cannot delete your own admin account" });
    }

    await prisma.user.update({
      where: { id: parseInt(id) },
      data: { role: "TENANT" },
    });

    await createAuditLog(adminClerkId, "DELETE_ADMIN", `Admin #${id}`, `Admin access revoked`);
    res.status(200).json({ message: "Admin deleted successfully" });
  } catch (error: any) {
    res.status(500).json({ message: "Failed to delete admin", error: error.message });
  }
};