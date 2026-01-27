import { Router } from "express";
import {
  getManager,
  createManager,
  updateManager,
  getManagerProperties,
} from "../controllers/managerControllers";

const router = Router();

// Get manager by userId
router.get("/:userId", getManager);

// Create new manager
router.post("/", createManager);

// Update manager
router.put("/:userId", updateManager);

// Get properties managed by a manager
router.get("/:userId/properties", getManagerProperties);

export default router;