import { Request, Response } from "express";
import { prisma } from "../lib/prisma";
import { wktToGeoJSON } from "@terraformer/wkt";
import cloudinary from "../lib/cloudinary";

// ── GET MANAGER ───────────────────────────────────────────
export const getManager = async (req: Request, res: Response): Promise<void> => {
  try {
    const { userId } = req.params;
    if (!userId) { res.status(400).json({ message: "userId is required" }); return; }

    const manager = await prisma.manager.findUnique({
      where: { clerkId: userId },
      include: { user: true },
    });

    if (!manager) { res.status(404).json({ message: "Manager not found" }); return; }

    res.json({
      ...manager,
      name: manager.user.name,
      email: manager.user.email,
      phoneNumber: manager.user.phoneNumber,
    });
  } catch (error: any) {
    res.status(500).json({ message: `Error retrieving manager: ${error.message}` });
  }
};

// ── CREATE MANAGER ────────────────────────────────────────
export const createManager = async (req: Request, res: Response): Promise<void> => {
  try {
    const { clerkId, name, email, phoneNumber } = req.body;

    if (!clerkId || !name || !email) {
      res.status(400).json({ message: "clerkId, name, and email are required" });
      return;
    }

    // ✅ Create User first
    const user = await prisma.user.upsert({
      where: { clerkId },
      update: { name, email, phoneNumber, role: "MANAGER" },
      create: { clerkId, name, email, phoneNumber: phoneNumber || "", role: "MANAGER" },
    });

    // ✅ Create Manager profile
    const existing = await prisma.manager.findUnique({ where: { userId: user.id } });
    if (existing) {
      res.status(200).json({ ...existing, name: user.name, email: user.email });
      return;
    }

    const manager = await prisma.manager.create({
      data: { clerkId, userId: user.id },
    });

    console.log(`✅ Manager created: ${user.name}`);
    res.status(201).json({ ...manager, name: user.name, email: user.email });
  } catch (error: any) {
    res.status(500).json({ message: `Error creating manager: ${error.message}` });
  }
};

// ── UPDATE MANAGER ────────────────────────────────────────
export const updateManager = async (req: Request, res: Response): Promise<void> => {
  try {
    const { userId } = req.params;
    const { name, email, phoneNumber } = req.body;

    if (!userId) { res.status(400).json({ message: "userId is required" }); return; }

    const manager = await prisma.manager.findUnique({
      where: { clerkId: userId },
      include: { user: true },
    });

    if (!manager) { res.status(404).json({ message: "Manager not found" }); return; }

    // ✅ Update User table
    const updatedUser = await prisma.user.update({
      where: { clerkId: userId },
      data: {
        ...(name && { name }),
        ...(email && { email }),
        ...(phoneNumber && { phoneNumber }),
      },
    });

    console.log(`✅ Manager updated: ${updatedUser.name}`);
    res.json({
      ...manager,
      name: updatedUser.name,
      email: updatedUser.email,
      phoneNumber: updatedUser.phoneNumber,
    });
  } catch (error: any) {
    res.status(500).json({ message: `Error updating manager: ${error.message}` });
  }
};

// ── GET MANAGER PROPERTIES ────────────────────────────────
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
            location: {
              ...property.location,
              coordinates: { longitude: 0, latitude: 0 },
            },
          };
        }
      })
    );

    res.json(formatted);
  } catch (error: any) {
    res.status(500).json({ message: `Error retrieving manager properties: ${error.message}` });
  }
};

// ── SUBMIT VERIFICATION ───────────────────────────────────
export const submitVerification = async (req: Request, res: Response): Promise<void> => {
  try {
    const clerkId = req.auth?.userId;
    if (!clerkId) {
      res.status(401).json({ message: "Unauthorized" });
      return;
    }

    const { phoneNumber } = req.body;
    const files = req.files as { [fieldname: string]: Express.Multer.File[] };

    if (!files?.ghanaCardFront || !files?.ghanaCardBack) {
      res.status(400).json({ message: "Both sides of Ghana Card are required" });
      return;
    }

    if (!phoneNumber) {
      res.status(400).json({ message: "Phone number is required" });
      return;
    }

    // ✅ Upload to Cloudinary
    const uploadToCloudinary = (file: Express.Multer.File): Promise<string> => {
      return new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          { folder: "askderek/verifications" },
          (error, result) => {
            if (error) reject(error);
            else resolve(result!.secure_url);
          }
        );
        stream.end(file.buffer);
      });
    };

    const frontUrl = await uploadToCloudinary(files.ghanaCardFront[0]);
    const backUrl = await uploadToCloudinary(files.ghanaCardBack[0]);

    // ✅ Save verification
    const existing = await prisma.landlordVerification.findUnique({
      where: { managerClerkId: clerkId },
    });

    if (existing) {
      await prisma.landlordVerification.update({
        where: { managerClerkId: clerkId },
        data: {
          ghanaCardFrontUrl: frontUrl,
          ghanaCardBackUrl: backUrl,
          phoneNumber,
          status: "Pending",
          submittedAt: new Date(),
          rejectionReason: null,
        },
      });
    } else {
      await prisma.landlordVerification.create({
        data: {
          managerClerkId: clerkId,
          ghanaCardFrontUrl: frontUrl,
          ghanaCardBackUrl: backUrl,
          phoneNumber,
          status: "Pending",
        },
      });
    }

    console.log(`✅ Verification submitted for ${clerkId}`);
    res.status(201).json({ message: "Verification submitted successfully!" });
  } catch (error: any) {
    console.error("❌ Verification error:", error.message);
    res.status(500).json({ message: `Error submitting verification: ${error.message}` });
  }
};

// -GET VERIFICATION STATUS ───────────────────────────────
export const getVerificationStatus = async (req: Request, res: Response): Promise<void> => {
  try {
    const clerkId = req.auth?.userId;

    if (!clerkId) {
      res.status(401).json({ message: "Unauthorized" });
      return;
    }

    const verification = await prisma.landlordVerification.findUnique({
      where: { managerClerkId: clerkId },
    });

    if (!verification) {
      res.status(404).json({ message: "No verification found" });
      return;
    }

    res.json(verification);
  } catch (error: any) {
    res.status(500).json({ message: `Error getting verification status: ${error.message}` });
  }
};