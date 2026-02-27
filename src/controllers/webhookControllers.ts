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

  const existingTenant = await prisma.tenant.findUnique({ where: { clerkId: id } });
  if (!existingTenant) {
    const tenant = await prisma.tenant.create({
      data: { clerkId: id, name, email, phoneNumber },
    });
    console.log(`✅ Tenant created: ${tenant.name}`);
  }

  if (userType === "manager") {
    const existingManager = await prisma.manager.findUnique({ where: { clerkId: id } });
    if (!existingManager) {
      const manager = await prisma.manager.create({
        data: { clerkId: id, name, email, phoneNumber },
      });
      console.log(`✅ Manager created: ${manager.name}`);
    }
  }
}

async function handleUserUpdated(data: any) {
  const { id, email_addresses, first_name, last_name, phone_numbers } = data;
  const email = email_addresses?.[0]?.email_address || "";
  const name = `${first_name || ""} ${last_name || ""}`.trim();
  const phoneNumber = phone_numbers?.[0]?.phone_number || "";

  try {
    await prisma.tenant.update({
      where: { clerkId: id },
      data: { ...(name && { name }), ...(email && { email }), ...(phoneNumber && { phoneNumber }) },
    });
  } catch (err) {
    console.log(`ℹ️ Tenant ${id} not found for update (may be manager-only)`);
  }

  try {
    await prisma.manager.update({
      where: { clerkId: id },
      data: { ...(name && { name }), ...(email && { email }), ...(phoneNumber && { phoneNumber }) },
    });
  } catch (err) {
    console.log(`ℹ️ Manager ${id} not found for update (may be tenant-only)`);
  }
}

async function handleUserDeleted(data: any) {
  const { id } = data;
  try { await prisma.tenant.delete({ where: { clerkId: id } }); } catch (err) {
    console.log(`ℹ️ Tenant ${id} not found for deletion`);
  }
  try { await prisma.manager.delete({ where: { clerkId: id } }); } catch (err) {
    console.log(`ℹ️ Manager ${id} not found for deletion`);
  }
  console.log(`✅ User deleted: ${id}`);
}