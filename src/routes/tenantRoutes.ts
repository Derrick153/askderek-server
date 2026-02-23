import { Router } from "express";
import {
  getTenant,
  createTenant,
  updateTenant,
  getCurrentResidences,
  addFavoriteProperty,
  removeFavoriteProperty,
  getTenantStats,
  getRecentProperties,
} from "../controllers/tenantControllers";

const router = Router();

/**
 * ✅ ROOT ROUTE
 * This fixes: "Cannot GET /api/tenants"
 */
router.get("/", (req, res) => {
  res.json({ message: "Tenants route working" });  
});

/**
 * CREATE tenant
 * POST /api/tenants
 */
router.post("/", createTenant);

/**
 * GET tenant stats
 * GET /api/tenants/:userId/stats
 */
router.get("/:userId/stats", getTenantStats);

/**
 * GET recent properties
 * GET /api/tenants/:userId/recent-properties
 */
router.get("/:userId/recent-properties", getRecentProperties);

/**
 * GET current residences - FIXED ROUTE! ✅
 * GET /api/tenants/:userId/current-residences
 */
router.get("/:userId/current-residences", getCurrentResidences);

/**
 * ADD favorite property
 * POST /api/tenants/:userId/favorites/:propertyId 
 */
router.post("/:userId/favorites/:propertyId", addFavoriteProperty);

/**
 * REMOVE favorite property
 * DELETE /api/tenants/:userId/favorites/:propertyId
 */
router.delete("/:userId/favorites/:propertyId", removeFavoriteProperty);

/**
 * GET tenant by userId
 * GET /api/tenants/:userId
 * ⚠️ MUST BE LAST - catches everything else       
 */
router.get("/:userId", getTenant);

/**
 * UPDATE tenant
 * PUT /api/tenants/:userId
 */
router.put("/:userId", updateTenant);

export default router;