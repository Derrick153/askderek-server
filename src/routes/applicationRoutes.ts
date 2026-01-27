import { Router } from "express";
import {
  listApplications,
  createApplication,
  updateApplicationStatus,
} from "../controllers/applicationControllers";

const router = Router();

// List applications (with optional query params: userId, userType)
router.get("/", listApplications);

// Create new application
router.post("/", createApplication);

// Update application status
router.put("/:id/status", updateApplicationStatus);

export default router;