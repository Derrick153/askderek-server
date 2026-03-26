import { Request, Response } from "express";
import { prisma } from "../lib/prisma";
import { Webhook } from "svix";

export const handleClerkWebhook = async (req: Request, res: Response) => {
  try {
    const WEBHOOK_SECRET = process.env.CLERK_WEBHOOK_SECRET;
    if (!WEBHOOK_SECRET) {
      return res.status(500).json({ error: "Webhook secret not configured" });
    }

    const svix_id = req.headers["svix-id"] as string;
    const svix_timestamp = req.headers["svix-timestamp"] as string;
    const svix_signature = req.headers["svix-signature"] as string;

    if (!svix_id || !svix_timestamp || !svix_signature) {
      return res.status(400).json({ error: "Missing svix headers" });
    }

    const wh = new Webhook(WEBHOOK_SECRET);
    let evt: any;

    try {
      evt = wh.verify(JSON.stringify(req.body), {
        "svix-id": svix_id,
        "svix-timestamp": svix_timestamp,
        "svix-signature": svix_signature,
      });
    } catch (err) {
      return res.status(400).json({ error: "Webhook verification failed" });
    }

    const { type, data } = evt;
    console.log(`📩 Clerk Webhook: ${type}`);

    switch (type) {
      case "user.created": await handleUserCreated(data); break;
      case "user.updated": await handleUserUpdated(data); break;
      case "user.deleted": await handleUserDeleted(data); break;
      default: console.log(`ℹ️ Unhandled webhook type: ${type}`);
    }

    return res.status(200).json({ success: true, type });
  } catch (error) {
    console.error("❌ Webhook error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
};

async function handleUserCreated(data: any) {
  const { id, email_addresses, first_name, last_name, phone_numbers, public_metadata } = data;

  const email = email_addresses?.[0]?.email_address || "";
  const name = `${first_name || ""} ${last_name || ""}`.trim() || "User";
  const phoneNumber = phone_numbers?.[0]?.phone_number || "";
  const userType = (public_metadata?.userType as string) || "tenant";

  // ✅ 1. Create User FIRST
  const user = await prisma.user.upsert({
    where: { clerkId: id },
    update: { email, name, phoneNumber },
    create: {
      clerkId: id,
      email,
      name,
      phoneNumber,
      role: userType === "admin" ? "ADMIN" : userType === "manager" ? "MANAGER" : "TENANT",
    },
  });

  console.log(`✅ User created/updated: ${user.name} (${user.role})`);

  // ✅ 2. If Admin — no profile needed
  if (user.role === "ADMIN") {
    console.log(`✅ Admin user registered: ${user.name}`);
    return;
  }

  // ✅ 3. If Tenant — create Tenant profile
  if (user.role === "TENANT") {
    const existingTenant = await prisma.tenant.findUnique({
      where: { userId: user.id },
    });

    if (!existingTenant) {
      await prisma.tenant.create({
        data: {
          clerkId: id,
          userId: user.id,
          phoneNumber,
        },
      });
      console.log(`✅ Tenant profile created for: ${user.name}`);
    }
  }

  // ✅ 4. If Manager — create Manager profile
  if (user.role === "MANAGER") {
    const existingManager = await prisma.manager.findUnique({
      where: { userId: user.id },
    });

    if (!existingManager) {
      await prisma.manager.create({
        data: {
          clerkId: id,
          userId: user.id,
        },
      });
      console.log(`✅ Manager profile created for: ${user.name}`);
    }
  }
}

async function handleUserUpdated(data: any) {
  const { id, email_addresses, first_name, last_name, phone_numbers } = data;

  const email = email_addresses?.[0]?.email_address || "";
  const name = `${first_name || ""} ${last_name || ""}`.trim();
  const phoneNumber = phone_numbers?.[0]?.phone_number || "";

  const user = await prisma.user.findUnique({
    where: { clerkId: id },
  });

  if (!user) {
    console.log(`⚠️ User not found for update: ${id}`);
    return;
  }

  // ✅ Update ONLY User table
  await prisma.user.update({
    where: { clerkId: id },
    data: {
      ...(name && { name }),
      ...(email && { email }),
      ...(phoneNumber && { phoneNumber }),
    },
  });

  console.log(`✅ User updated: ${id}`);
}

async function handleUserDeleted(data: any) {
  const { id } = data;

  try {
    await prisma.user.delete({
      where: { clerkId: id },
    });
    console.log(`✅ User deleted: ${id}`);
  } catch (err) {
    console.log(`ℹ️ User ${id} not found for deletion`);
  }
}