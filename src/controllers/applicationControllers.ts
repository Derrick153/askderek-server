import { Request, Response } from "express";
import { prisma } from "../lib/prisma";

// ─── LIST APPLICATIONS ────────────────────────────────────────────────────────
export const listApplications = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { userId, userType } = req.query;

    if (!userId || !userType) {
      res.status(400).json({ message: "userId and userType are required" });
      return;
    }

    let whereClause = {};

    if (userType === "tenant") {
      whereClause = { tenantClerkId: String(userId) };
    } else if (userType === "manager") {
      whereClause = {
        property: { managerClerkId: String(userId) },
      };
    } else {
      res.status(400).json({ message: "userType must be 'tenant' or 'manager'" });
      return;
    }

    const applications = await prisma.application.findMany({
      where: whereClause,
      include: {
        property: {
          include: {
            location: true,
            manager: true,
          },
        },
        tenant: true,
        lease: true,
      },
      orderBy: { applicationDate: "desc" },
    });

    const calculateNextPaymentDate = (startDate: Date): Date => {
      const today = new Date();
      const next = new Date(startDate);
      while (next <= today) {
        next.setMonth(next.getMonth() + 1);
      }
      return next;
    };

    const formatted = applications.map((app) => ({
      ...app,
      property: {
        ...app.property,
        address: app.property.location.address,
      },
      manager: app.property.manager,
      lease: app.lease
        ? {
            ...app.lease,
            nextPaymentDate: calculateNextPaymentDate(app.lease.startDate),
          }
        : null,
    }));

    res.json(formatted);
  } catch (error: any) {
    console.error("❌ Error retrieving applications:", error);
    res.status(500).json({ message: `Error retrieving applications: ${error.message}` });
  }
};

// ─── CREATE APPLICATION ───────────────────────────────────────────────────────
export const createApplication = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { propertyId, tenantClerkId, name, email, phoneNumber, message } = req.body;

    if (!propertyId || !tenantClerkId || !name || !email || !phoneNumber) {
      res.status(400).json({
        message: "propertyId, tenantClerkId, name, email, and phoneNumber are required",
      });
      return;
    }

    const property = await prisma.property.findUnique({
      where: { id: Number(propertyId) },
    });

    if (!property) {
      res.status(404).json({ message: "Property not found" });
      return;
    }

    const existing = await prisma.application.findFirst({
      where: {
        propertyId: Number(propertyId),
        tenantClerkId: String(tenantClerkId),
        status: { in: ["Pending", "Approved"] },
      },
    });

    if (existing) {
      res.status(400).json({
        message: "You already have an active application for this property",
      });
      return;
    }

    let tenant = await prisma.tenant.findUnique({
      where: { clerkId: String(tenantClerkId) },
    });

    if (!tenant) {
      tenant = await prisma.tenant.create({
        data: {
          clerkId: String(tenantClerkId),
          name,
          email,
          phoneNumber,
        },
      });
      console.log("✅ New tenant created:", tenant.name);
    }

    const application = await prisma.application.create({
      data: {
        applicationDate: new Date(),
        status: "Pending",
        name,
        email,
        phoneNumber,
        message: message || "",
        property: { connect: { id: Number(propertyId) } },
        tenant: { connect: { clerkId: String(tenantClerkId) } },
      },
      include: {
        property: { include: { location: true, manager: true } },
        tenant: true,
      },
    });

    console.log("✅ Application created:", application.id);
    res.status(201).json(application);
  } catch (error: any) {
    console.error("❌ Application creation error:", error);
    res.status(500).json({ message: `Error creating application: ${error.message}` });
  }
};

// ─── UPDATE APPLICATION STATUS ────────────────────────────────────────────────
export const updateApplicationStatus = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    const validStatuses = ["Approved", "Denied", "Pending"];
    if (!validStatuses.includes(status)) {
      res.status(400).json({
        message: `Invalid status. Must be one of: ${validStatuses.join(", ")}`,
      });
      return;
    }

    const application = await prisma.application.findUnique({
      where: { id: Number(id) },
      include: { property: true, tenant: true },
    });

    if (!application) {
      res.status(404).json({ message: "Application not found" });
      return;
    }

    if (application.status !== "Pending") {
      res.status(400).json({
        message: `Application has already been ${application.status}. Cannot update again.`,
      });
      return;
    }

    if (status === "Approved") {
      console.log(`✅ Approving application ${id} — creating lease...`);

      const leaseStart = new Date();
      const leaseEnd = new Date();
      leaseEnd.setFullYear(leaseEnd.getFullYear() + 1);

      const lease = await prisma.lease.create({
        data: {
          startDate: leaseStart,
          endDate: leaseEnd,
          rent: application.property.pricePerMonth,
          deposit: application.property.securityDeposit,
          propertyId: application.propertyId,
          tenantClerkId: application.tenantClerkId,
        },
      });

      console.log("✅ Lease created:", lease.id);

      await prisma.payment.create({
        data: {
          leaseId: lease.id,
          amountDue: application.property.pricePerMonth,
          amountPaid: 0,
          dueDate: new Date(),
          paymentStatus: "Pending",
        },
      });

      console.log("✅ First payment record created");

      await prisma.property.update({
        where: { id: application.propertyId },
        data: {
          tenants: { connect: { clerkId: application.tenantClerkId } },
        },
      });

      await prisma.application.update({
        where: { id: Number(id) },
        data: { status: "Approved", leaseId: lease.id },
      });

      console.log("✅ Application approved and linked to lease");
    } else {
      await prisma.application.update({
        where: { id: Number(id) },
        data: { status },
      });
      console.log(`✅ Application ${id} updated to: ${status}`);
    }

    const updated = await prisma.application.findUnique({
      where: { id: Number(id) },
      include: {
        property: { include: { location: true, manager: true } },
        tenant: true,
        lease: true,
      },
    });

    res.json(updated);
  } catch (error: any) {
    console.error("❌ Error updating application status:", error);
    res.status(500).json({ message: `Error updating application status: ${error.message}` });
  }
};