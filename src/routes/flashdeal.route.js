import express from "express";
import { verifyJWT, authorizeRoles } from "../middlerwares/authmiddlerware.js";
import { upload } from "../middlerwares/multer.middlerware.js";
import {
  createFlashDeal,
  getFlashDeals,
  getFlashDealById,
  updateFlashDeal,
  deleteFlashDeal,
  getAllFlashDeals,
} from "../controller/flashdeal.controller.js";
import { apiRateLimiter } from "../middlerwares/rateLimit.middlerware.js";

const router = express.Router();

router.use(apiRateLimiter);

// Public routes
router.get("/", getFlashDeals);

// Admin routes (must come before /:id to avoid route conflicts)
router.get("/admin/all", verifyJWT, authorizeRoles("admin"), getAllFlashDeals);
router.post("/", verifyJWT, authorizeRoles("admin"), upload.single("banner"), createFlashDeal);
router.patch("/:id", verifyJWT, authorizeRoles("admin"), upload.single("banner"), updateFlashDeal);
router.delete("/:id", verifyJWT, authorizeRoles("admin"), deleteFlashDeal);

// Public routes (must come after admin routes)
router.get("/:id", getFlashDealById);

export default router;

