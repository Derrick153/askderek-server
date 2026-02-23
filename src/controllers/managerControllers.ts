import { Request, Response } from "express";
import { prisma } from "../lib/prisma";
import { wktToGeoJSON } from "@terraformer/wkt";

export const getManager = async (req: Request, res: Response): Promise<void> => {
  try {
    const { userId } = req.params;
    if (!userId) { res.status(400).json({ message: "userId is required" }); return; }

    const manager = await prisma.manager.findUnique({ where: { clerkId: userId } });
    if (!manager) { res.status(404).json({ message: "Manager not found" }); return; }

    res.json(manager);
  } catch (error: any) {
    res.status(500).json({ message: `Error retrieving manager: ${error.message}` });
  }
};

export const createManager = async (req: Request, res: Response): Promise<void> => {
  try {
    const { clerkId, name, email, phoneNumber } = req.body;
    if (!clerkId || !name || !email) {
      res.status(400).json({ message: "clerkId, name, and email are required" });
      return;
    }

    const existing = await prisma.manager.findUnique({ where: { clerkId } });
    if (existing) { res.status(200).json(existing); return; }

    const manager = await prisma.manager.create({
      data: { clerkId, name, email, phoneNumber: phoneNumber || "" },
    });
    console.log(`✅ Manager created: ${manager.name}`);
    res.status(201).json(manager);
  } catch (error: any) {
    res.status(500).json({ message: `Error creating manager: ${error.message}` });
  }
};

export const updateManager = async (req: Request, res: Response): Promise<void> => {
  try {
    const { userId } = req.params;
    const { name, email, phoneNumber } = req.body;
    if (!userId) { res.status(400).json({ message: "userId is required" }); return; }

    const existing = await prisma.manager.findUnique({ where: { clerkId: userId } });
    if (!existing) { res.status(404).json({ message: "Manager not found" }); return; }

    const updated = await prisma.manager.update({
      where: { clerkId: userId },
      data: {
        name: name || existing.name,
        email: email || existing.email,
        phoneNumber: phoneNumber || existing.phoneNumber,
      },
    });
    console.log(`✅ Manager updated: ${updated.name}`);
    res.json(updated);
  } catch (error: any) {
    res.status(500).json({ message: `Error updating manager: ${error.message}` });
  }
};

export const getManagerProperties = async (req: Request, res: Response): Promise<void> => {
  try {
    const { userId } = req.params;
    if (!userId) { res.status(400).json({ message: "userId is required" }); return; }

    const properties = await prisma.property.findMany({
      where: { managerClerkId: userId },
      include: {
        location: true,
        leases: true,
        applications: { where: { status: "Pending" } },
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
            location: { ...property.location, coordinates: { longitude: 0, latitude: 0 } },
          };
        }
      })
    );

    res.json(formatted);
  } catch (error: any) {
    res.status(500).json({ message: `Error retrieving manager properties: ${error.message}` });
  }
};