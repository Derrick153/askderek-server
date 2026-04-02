import express from "express";
import { sendPhoneOTP, verifyPhoneOTP } from "../controllers/otpControllers";
import { authMiddleware } from "../middleware/authMiddleware";

const router = express.Router();

router.post("/send", authMiddleware(), sendPhoneOTP);
router.post("/verify", authMiddleware(), verifyPhoneOTP);

export default router;