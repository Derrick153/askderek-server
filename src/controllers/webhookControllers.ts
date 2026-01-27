// server/src/controllers/webhookControllers.ts
import { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";
import { Webhook } from "svix";

const prisma = new PrismaClient();

/**
 * Clerk Webhook Handler
 * Automatically creates/updates/deletes users in database when Clerk events occur
 */
export const handleClerkWebhook = async (req: Request, res: Response) => {
  try {
    // Get webhook secret from environment
    const WEBHOOK_SECRET = process.env.CLERK_WEBHOOK_SECRET;

    if (!WEBHOOK_SECRET) {
      console.error("❌ CLERK_WEBHOOK_SECRET is not set");
      return res.status(500).json({ error: "Webhook secret not configured" });
    }

    // Get Svix headers for verification
    const svix_id = req.headers["svix-id"] as string;
    const svix_timestamp = req.headers["svix-timestamp"] as string;
    const svix_signature = req.headers["svix-signature"] as string;

    if (!svix_id || !svix_timestamp || !svix_signature) {
      return res.status(400).json({ error: "Missing svix headers" });
    }

    // Verify the webhook signature
    const wh = new Webhook(WEBHOOK_SECRET);
    let evt: any;

    try {
      evt = wh.verify(JSON.stringify(req.body), {
        "svix-id": svix_id,
        "svix-timestamp": svix_timestamp,
        "svix-signature": svix_signature,
      });
    } catch (err) {
      console.error("❌ Webhook verification failed:", err);
      return res.status(400).json({ error: "Webhook verification failed" });
    }

    // Handle different event types
    const { type, data } = evt;
    console.log(`📩 Clerk Webhook received: ${type}`);

    switch (type) {
      case "user.created":
        await handleUserCreated(data);
        break;

      case "user.updated":
        await handleUserUpdated(data);
        break;

      case "user.deleted":
        await handleUserDeleted(data);
        break;

      default:
        console.log(`ℹ️ Unhandled webhook type: ${type}`);
    }

    return res.status(200).json({ success: true, type });
  } catch (error) {
    console.error("❌ Webhook error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
};

/**
 * Handle user.created event - Create tenant in database
 */
async function handleUserCreated(data: any) {
  try {
    const { id, email_addresses, first_name, last_name, phone_numbers, public_metadata } = data;

    // Extract user info
    const email = email_addresses?.[0]?.email_address || "";
    const name = `${first_name || ""} ${last_name || ""}`.trim() || "User";
    const phoneNumber = phone_numbers?.[0]?.phone_number || "";
    const userType = (public_metadata?.userType as string) || "tenant";

    // Check if user already exists
    const existingTenant = await prisma.tenant.findUnique({
      where: { clerkId: id },
    });

    if (existingTenant) {
      console.log(`ℹ️ Tenant already exists: ${id}`);
      return;
    }

    // Create tenant
    const tenant = await prisma.tenant.create({
      data: {
        clerkId: id,
        name,
        email,
        phoneNumber,
      },
    });

    console.log(`✅ Tenant created: ${tenant.name} (${tenant.clerkId})`);

    // If user is a manager, also create manager record
    if (userType === "manager") {
      const existingManager = await prisma.manager.findUnique({
        where: { clerkId: id },
      });

      if (!existingManager) {
        const manager = await prisma.manager.create({
          data: {
            clerkId: id,
            name,
            email,
            phoneNumber,
          },
        });
        console.log(`✅ Manager created: ${manager.name} (${manager.clerkId})`);
      }
    }
  } catch (error) {
    console.error("❌ Error creating user:", error);
    throw error;
  }
}

/**
 * Handle user.updated event - Update tenant in database
 */
async function handleUserUpdated(data: any) {
  try {
    const { id, email_addresses, first_name, last_name, phone_numbers } = data;

    const email = email_addresses?.[0]?.email_address || "";
    const name = `${first_name || ""} ${last_name || ""}`.trim();
    const phoneNumber = phone_numbers?.[0]?.phone_number || "";

    // Update tenant
    const tenant = await prisma.tenant.update({
      where: { clerkId: id },
      data: {
        ...(name && { name }),
        ...(email && { email }),
        ...(phoneNumber && { phoneNumber }),
      },
    });

    console.log(`✅ Tenant updated: ${tenant.name} (${tenant.clerkId})`);

    // Also update manager if exists
    try {
      await prisma.manager.update({
        where: { clerkId: id },
        data: {
          ...(name && { name }),
          ...(email && { email }),
          ...(phoneNumber && { phoneNumber }),
        },
      });
    } catch (err) {
      // Manager doesn't exist, that's fine
    }
  } catch (error) {
    console.error("❌ Error updating user:", error);
    throw error;
  }
}

/**
 * Handle user.deleted event - Delete tenant from database
 */
async function handleUserDeleted(data: any) {
  try {
    const { id } = data;

    // Delete tenant (cascade will handle related data)
    await prisma.tenant.delete({
      where: { clerkId: id },
    });

    console.log(`✅ Tenant deleted: ${id}`);

    // Also delete manager if exists
    try {
      await prisma.manager.delete({
        where: { clerkId: id },
      });
      console.log(`✅ Manager deleted: ${id}`);
    } catch (err) {
      // Manager doesn't exist, that's fine
    }
  } catch (error) {
    console.error("❌ Error deleting user:", error);
    throw error;
  }
}