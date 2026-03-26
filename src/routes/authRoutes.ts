import express from "express";
import { registerUser, getMe } from "../controllers/authControllers";
import { authMiddleware } from "../middleware/authMiddleware";

const router = express.Router();

router.post("/register", registerUser);
router.get("/me", authMiddleware(), getMe);

export default router;