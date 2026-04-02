import { Router } from "express";
import {
  getRegions,
  getCities,
  getAreas,
  searchLocations,
  checkLocation,
  getCitiesAll,
} from "../controllers/locationControllers";

const router = Router();

// ── PUBLIC ROUTES ─────────────────────────────────────────
router.get("/regions", getRegions);
router.get("/regions/:regionSlug/cities", getCities);
router.get("/regions/:regionSlug/cities/:citySlug/areas", getAreas);
router.get("/cities", getCitiesAll);
router.get("/search", searchLocations);
router.post("/validate", checkLocation);

export default router;