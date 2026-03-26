import { Request, Response } from "express";
import { prisma } from "../lib/prisma";
import { wktToGeoJSON } from "@terraformer/wkt";

// ── GET TENANT ────────────────────────────────────────────
export const getTenant = async (req: Request, res: Response): Promise<void> => {
  try {
    const { userId } = req.params;

    const tenant = await prisma.tenant.findUnique({
      where: { clerkId: userId },
      include: {
        user: true,
        favorites: { include: { location: true } },
      },
    });

    if (tenant) {
      res.json({
        ...tenant,
        name: tenant.user.name,
        email: tenant.user.email,
        phoneNumber: tenant.phoneNumber || tenant.user.phoneNumber,
      });
    } else {
      res.status(404).json({ message: "Tenant not found" });
    }
  } catch (error: any) {
    res.status(500).json({ message: `Error retrieving tenant: ${error.message}` });
  }
};

// ── CREATE TENANT ─────────────────────────────────────────
export const createTenant = async (req: Request, res: Response): Promise<void> => {
  try {
    const { clerkId, name, email, phoneNumber } = req.body;

    // ✅ Create User first
    const user = await prisma.user.upsert({
      where: { clerkId },
      update: { name, email, phoneNumber },
      create: { clerkId, name, email, phoneNumber, role: "TENANT" },
    });

    // ✅ Create Tenant profile
    const tenant = await prisma.tenant.upsert({
      where: { userId: user.id },
      update: { phoneNumber },
      create: { clerkId, userId: user.id, phoneNumber },
    });

    res.status(201).json({ ...tenant, name: user.name, email: user.email });
  } catch (error: any) {
    res.status(500).json({ message: `Error creating tenant: ${error.message}` });
  }
};

// ── UPDATE TENANT ─────────────────────────────────────────
export const updateTenant = async (req: Request, res: Response): Promise<void> => {
  try {
    const { userId } = req.params;
    const { name, email, phoneNumber } = req.body;

    // ✅ Update User table
    const user = await prisma.user.update({
      where: { clerkId: userId },
      data: {
        ...(name && { name }),
        ...(email && { email }),
        ...(phoneNumber && { phoneNumber }),
      },
    });

    // ✅ Update Tenant phone if provided
    const tenant = await prisma.tenant.update({
      where: { clerkId: userId },
      data: { ...(phoneNumber && { phoneNumber }) },
    });

    res.json({ ...tenant, name: user.name, email: user.email });
  } catch (error: any) {
    res.status(500).json({ message: `Error updating tenant: ${error.message}` });
  }
};

// ── GET CURRENT RESIDENCES ────────────────────────────────
export const getCurrentResidences = async (req: Request, res: Response): Promise<void> => {
  try {
    const { userId } = req.params;

    const properties = await prisma.property.findMany({
      where: {
        leases: {
          some: {
            tenantClerkId: userId,
            endDate: { gte: new Date() },
          },
        },
      },
      include: {
        location: true,
        leases: {
          where: { tenantClerkId: userId, endDate: { gte: new Date() } },
          orderBy: { startDate: "desc" },
        },
        manager: {
          include: { user: true },
        },
      },
    });

    const formatted = await Promise.all(
      properties.map(async (property) => {
        try {
          const coordinates: { coordinates: string }[] = await prisma.$queryRawUnsafe(
            `SELECT ST_asText(coordinates) as coordinates FROM "Location" WHERE id = $1`,
            property.location.id
          );
          const geoJSON: any = wktToGeoJSON(coordinates[0]?.coordinates || "");
          return {
            ...property,
            manager: {
              ...property.manager,
              name: property.manager?.user?.name,
              email: property.manager?.user?.email,
            },
            location: {
              ...property.location,
              coordinates: {
                longitude: geoJSON?.coordinates?.[0] ?? 0,
                latitude: geoJSON?.coordinates?.[1] ?? 0,
              },
            },
          };
        } catch {
          return {
            ...property,
            manager: {
              ...property.manager,
              name: property.manager?.user?.name,
              email: property.manager?.user?.email,
            },
            location: {
              ...property.location,
              coordinates: { longitude: 0, latitude: 0 },
            },
          };
        }
      })
    );

    res.json(formatted);
  } catch (err: any) {
    res.status(500).json({ message: `Error retrieving current residences: ${err.message}` });
  }
};

// ── ADD FAVORITE ──────────────────────────────────────────
export const addFavoriteProperty = async (req: Request, res: Response): Promise<void> => {
  try {
    const { userId, propertyId } = req.params;

    const tenant = await prisma.tenant.findUnique({
      where: { clerkId: userId },
      include: { favorites: true },
    });

    if (!tenant) {
      res.status(404).json({ message: "Tenant not found" });
      return;
    }

    const propertyIdNumber = Number(propertyId);
    const existingFavorites = tenant.favorites || [];

    if (!existingFavorites.some((fav: any) => fav.id === propertyIdNumber)) {
      const updatedTenant = await prisma.tenant.update({
        where: { clerkId: userId },
        data: { favorites: { connect: { id: propertyIdNumber } } },
        include: { favorites: { include: { location: true } } },
      });
      res.json(updatedTenant);
    } else {
      res.status(409).json({ message: "Property already added as favorite" });
    }
  } catch (error: any) {
    res.status(500).json({ message: `Error adding favorite property: ${error.message}` });
  }
};

// ── REMOVE FAVORITE ───────────────────────────────────────
export const removeFavoriteProperty = async (req: Request, res: Response): Promise<void> => {
  try {
    const { userId, propertyId } = req.params;

    const updatedTenant = await prisma.tenant.update({
      where: { clerkId: userId },
      data: { favorites: { disconnect: { id: Number(propertyId) } } },
      include: { favorites: { include: { location: true } } },
    });

    res.json(updatedTenant);
  } catch (err: any) {
    res.status(500).json({ message: `Error removing favorite property: ${err.message}` });
  }
};

// ── GET TENANT STATS ──────────────────────────────────────
export const getTenantStats = async (req: Request, res: Response): Promise<void> => {
  try {
    const { userId } = req.params;

    const [viewedCount, tenant, applicationsCount, recentViewsCount] = await Promise.all([
      prisma.propertyView.count({ where: { tenantClerkId: userId } }),
      prisma.tenant.findUnique({
        where: { clerkId: userId },
        select: { _count: { select: { favorites: true } } },
      }),
      prisma.application.count({
        where: { tenantClerkId: userId, status: { in: ["Pending", "Approved"] } },
      }),
      prisma.propertyView.count({
        where: {
          tenantClerkId: userId,
          viewedAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
        },
      }),
    ]);

    res.json({
      viewedPropertiesCount: viewedCount,
      savedFavoritesCount: tenant?._count?.favorites || 0,
      activeApplicationsCount: applicationsCount,
      recentViewsCount,
    });
  } catch (error: any) {
    res.status(500).json({ message: `Error fetching tenant stats: ${error.message}` });
  }
};

// ── GET RECENT PROPERTIES ─────────────────────────────────
export const getRecentProperties = async (req: Request, res: Response): Promise<void> => {
  try {
    const { userId } = req.params;
    const limit = parseInt(req.query.limit as string) || 10;

    const recentViews = await prisma.propertyView.findMany({
      where: { tenantClerkId: userId },
      orderBy: { viewedAt: "desc" },
      take: limit,
      include: {
        property: {
          select: {
            id: true, name: true, pricePerMonth: true, beds: true,
            baths: true, photoUrls: true,
            location: { select: { address: true, city: true } },
          },
        },
      },
    });

    const formattedProperties = recentViews.map((view) => ({
      id: view.property.id.toString(),
      title: view.property.name,
      location: `${view.property.location.address}, ${view.property.location.city}`,
      price: view.property.pricePerMonth,
      bedrooms: view.property.beds,
      bathrooms: view.property.baths,
      imageUrl: view.property.photoUrls[0] || null,
      viewedAt: view.viewedAt,
    }));

    res.json(formattedProperties);
  } catch (error: any) {
    res.status(500).json({ message: `Error fetching recent properties: ${error.message}` });
  }
};