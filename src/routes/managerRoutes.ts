import { Router } from "express";
import {
  getManager,
  createManager,
  updateManager,
  getManagerProperties,
  submitVerification,
  getVerificationStatus,
} from "../controllers/managerControllers";
import { authMiddleware } from "../middleware/authMiddleware";
import { upload } from "../middleware/upload";

const router = Router();

// ── PUBLIC ROUTES ─────────────────────────────────────────
router.post("/", createManager);

// ── VERIFICATION ──────────────────────────────────────────
router.get("/verification/status", authMiddleware(), getVerificationStatus);
router.post(
  "/verification/submit",
  authMiddleware(),
  upload.fields([
    { name: "ghanaCardFront", maxCount: 1 },
    { name: "ghanaCardBack", maxCount: 1 },
  ]),
  submitVerification
);

// ── PROTECTED ROUTES ──────────────────────────────────────
router.get("/:userId/properties", getManagerProperties);
router.get("/:userId", getManager);
router.put("/:userId", updateManager);

export default router;