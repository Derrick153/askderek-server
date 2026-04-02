import { Request, Response } from "express";
import { prisma } from "../lib/prisma";
import { sendOTP } from "../lib/sms";
import bcrypt from "bcrypt";

// ── GENERATE OTP ──────────────────────────────────────────
const generateOTP = (): string => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

// ── FORMAT GHANA NUMBER ───────────────────────────────────
const formatPhone = (phone: string): string => {
  let formatted = phone.replace(/\s/g, "");

  if (formatted.startsWith("0")) {
    formatted = "+233" + formatted.slice(1);
  }

  if (!formatted.startsWith("+")) {
    formatted = "+233" + formatted;
  }

  return formatted;
};

// ── SEND OTP ──────────────────────────────────────────────
export const sendPhoneOTP = async (req: Request, res: Response): Promise<void> => {
  try {
    const { phoneNumber } = req.body;
    const clerkId = req.auth?.userId;

    if (!clerkId) {
      res.status(401).json({ message: "Unauthorized" });
      return;
    }

    if (!phoneNumber) {
      res.status(400).json({ message: "Phone number is required" });
      return;
    }

    // ✅ Rate limit (1 per minute)
    const recentOTP = await prisma.oTP.findFirst({
      where: {
        clerkId,
        createdAt: {
          gt: new Date(Date.now() - 60 * 1000),
        },
      },
    });

    if (recentOTP) {
      res.status(429).json({
        message: "Please wait 1 minute before requesting another OTP",
      });
      return;
    }

    const formattedPhone = formatPhone(phoneNumber);

    const otp = generateOTP();
    const hashedOTP = await bcrypt.hash(otp, 10);

    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    // ✅ Delete old OTPs
    await prisma.oTP.deleteMany({ where: { clerkId } });

    // ✅ Save hashed OTP
    await prisma.oTP.create({
      data: {
        clerkId,
        otp: hashedOTP,
        phone: formattedPhone,
        expiresAt,
      },
    });

    // ✅ Send SMS
    const sent = await sendOTP(formattedPhone, otp);

    if (!sent) {
      res.status(500).json({
        message: "Failed to send OTP. Please try again.",
      });
      return;
    }

    console.log(`✅ OTP sent to ${formattedPhone}`);

    res.status(200).json({
      message: "OTP sent successfully",
      phone: formattedPhone,
    });
  } catch (error: any) {
    console.error("❌ Send OTP error:", error.message);
    res.status(500).json({
      message: `Error sending OTP: ${error.message}`,
    });
  }
};

// ── VERIFY OTP ────────────────────────────────────────────
export const verifyPhoneOTP = async (req: Request, res: Response): Promise<void> => {
  try {
    const { otp, phoneNumber } = req.body;
    const clerkId = req.auth?.userId;

    if (!clerkId) {
      res.status(401).json({ message: "Unauthorized" });
      return;
    }

    if (!otp || !phoneNumber) {
      res.status(400).json({ message: "OTP and phone number are required" });
      return;
    }

    const formattedPhone = formatPhone(phoneNumber);

    // ✅ Get latest OTP
    const stored = await prisma.oTP.findFirst({
      where: { clerkId },
      orderBy: { createdAt: "desc" },
    });

    if (!stored) {
      res.status(400).json({
        message: "No OTP found. Please request a new one.",
      });
      return;
    }

    // ✅ Expiry check
    if (new Date() > stored.expiresAt) {
      await prisma.oTP.deleteMany({ where: { clerkId } });
      res.status(400).json({
        message: "OTP has expired. Please request a new one.",
      });
      return;
    }

    // ✅ Phone match check
    if (stored.phone !== formattedPhone) {
      res.status(400).json({
        message: "Phone number mismatch",
      });
      return;
    }

    // ✅ Compare hashed OTP
    const isValid = await bcrypt.compare(otp, stored.otp);

    if (!isValid) {
      res.status(400).json({
        message: "Invalid OTP. Please try again.",
      });
      return;
    }

    // ✅ Update user
    await prisma.user.update({
      where: { clerkId },
      data: {
        phoneNumber: stored.phone,
        isPhoneVerified: true,
      },
    });

    // ✅ Delete OTP
    await prisma.oTP.deleteMany({ where: { clerkId } });

    console.log(`✅ Phone verified for ${clerkId}`);

    res.status(200).json({
      message: "Phone number verified successfully!",
    });
  } catch (error: any) {
    console.error("❌ Verify OTP error:", error.message);
    res.status(500).json({
      message: `Error verifying OTP: ${error.message}`,
    });
  }
};