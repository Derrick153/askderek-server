import { Router } from "express";
import {
  getTenant,
  createTenant,
  updateTenant,
  getCurrentResidences,
  addFavoriteProperty,
  removeFavoriteProperty,
} from "../controllers/tenantControllers";

const router = Router();

router.get("/:userId", getTenant);
router.post("/", createTenant);
router.put("/:userId", updateTenant);
router.get("/:userId/residences", getCurrentResidences);
router.post("/:userId/favorites/:propertyId", addFavoriteProperty);
router.delete("/:userId/favorites/:propertyId", removeFavoriteProperty);

export default router;