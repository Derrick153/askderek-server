import express from "express";
import {
  getProperties,
  getProperty,
  createProperty,
  getPropertyLeases,
} from "../controllers/propertyControllers";
import multer from "multer";

const storage = multer.memoryStorage();
const upload = multer({ storage: storage });
const router = express.Router();

router.get("/", getProperties);
router.get("/:id/leases", getPropertyLeases);
router.get("/:id", getProperty);
router.post("/", upload.array("photos"), createProperty);

export default router;