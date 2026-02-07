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

// Purpose: Flash deal routes for public access and admin management

const router = express.Router();

router.use(apiRateLimiter);

router.get("/", getFlashDeals);

router.get("/admin/all", verifyJWT, authorizeRoles("admin"), getAllFlashDeals);
router.post("/", verifyJWT, authorizeRoles("admin"), upload.single("banner"), createFlashDeal);
router.patch("/:id", verifyJWT, authorizeRoles("admin"), upload.single("banner"), updateFlashDeal);
router.delete("/:id", verifyJWT, authorizeRoles("admin"), deleteFlashDeal);

router.get("/:id", getFlashDealById);

export default router;

