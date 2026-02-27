import { Router } from "express";
import {
  getManager,
  createManager,
  updateManager,
  getManagerProperties,
} from "../controllers/managerControllers";

const router = Router();

// Create new manager
router.post("/", createManager);

// Get properties managed by a manager (must be before /:userId)
router.get("/:userId/properties", getManagerProperties);

// Get manager by userId
router.get("/:userId", getManager);

// Update manager
router.put("/:userId", updateManager);

export default router;