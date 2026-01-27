import { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";
import { wktToGeoJSON } from "@terraformer/wkt";

const prisma = new PrismaClient();

export const getTenant = async (req: Request, res: Response): Promise<void> => {
  try {
    const { userId } = req.params;
    const tenant = await prisma.tenant.findUnique({
      where: { clerkId: userId },
      include: {
        favorites: {
          include: {
            location: true,
          },
        },
      },
    });

    if (tenant) {
      res.json(tenant);
    } else {
      res.status(404).json({ message: "Tenant not found" });
    }
  } catch (error: any) {
    res.status(500).json({ message: `Error retrieving tenant: ${error.message}` });
  }
};

export const createTenant = async (req: Request, res: Response): Promise<void> => {
  try {
    const { clerkId, name, email, phoneNumber } = req.body;
    const tenant = await prisma.tenant.create({
      data: { clerkId, name, email, phoneNumber },
    });
    res.status(201).json(tenant);
  } catch (error: any) {
    res.status(500).json({ message: `Error creating tenant: ${error.message}` });
  }
};

export const updateTenant = async (req: Request, res: Response): Promise<void> => {
  try {
    const { userId } = req.params;
    const { name, email, phoneNumber } = req.body;
    const updatedTenant = await prisma.tenant.update({
      where: { clerkId: userId },
      data: { name, email, phoneNumber },
    });
    res.json(updatedTenant);
  } catch (error: any) {
    res.status(500).json({ message: `Error updating tenant: ${error.message}` });
  }
};

export const getCurrentResidences = async (req: Request, res: Response): Promise<void> => {
  try {
    const { userId } = req.params;
    const properties = await prisma.property.findMany({
      where: { tenants: { some: { clerkId: userId } } },
      include: { location: true },
    });

    const residencesWithFormattedLocation = await Promise.all(
      properties.map(async (property: any) => {
        const coordinates: { coordinates: string }[] = await prisma.$queryRaw`SELECT ST_asText(coordinates) as coordinates from "Location" where id = ${property.location.id}`;
        const geoJSON: any = wktToGeoJSON(coordinates[0]?.coordinates || "");
        const longitude = geoJSON.coordinates[0];
        const latitude = geoJSON.coordinates[1];

        return {
          ...property,
          location: {
            ...property.location,
            coordinates: { longitude, latitude },
          },
        };
      })
    );

    res.json(residencesWithFormattedLocation);
  } catch (err: any) {
    res.status(500).json({ message: `Error retrieving current residences: ${err.message}` });
  }
};

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
        data: {
          favorites: { connect: { id: propertyIdNumber } },
        },
        include: {
          favorites: {
            include: { location: true },
          },
        },
      });
      res.json(updatedTenant);
    } else {
      res.status(409).json({ message: "Property already added as favorite" });
    }
  } catch (error: any) {
    res.status(500).json({ message: `Error adding favorite property: ${error.message}` });
  }
};

export const removeFavoriteProperty = async (req: Request, res: Response): Promise<void> => {
  try {
    const { userId, propertyId } = req.params;
    const propertyIdNumber = Number(propertyId);

    const updatedTenant = await prisma.tenant.update({
      where: { clerkId: userId },
      data: {
        favorites: { disconnect: { id: propertyIdNumber } },
      },
      include: {
        favorites: {
          include: { location: true },
        },
      },
    });

    res.json(updatedTenant);
  } catch (err: any) {
    res.status(500).json({ message: `Error removing favorite property: ${err.message}` });
  }
};