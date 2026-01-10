import express from "express";
import { verifyJWT, authorizeRoles } from "../middlerwares/authmiddlerware.js";
import { upload } from "../middlerwares/multer.middlerware.js";
import {
  createHomepageSlider,
  getHomepageSliders,
  getHomepageSliderById,
  updateHomepageSlider,
  deleteHomepageSlider,
  getAllHomepageSliders,
} from "../controller/homepageslider.controller.js";
import { apiRateLimiter } from "../middlerwares/rateLimit.middlerware.js";

const router = express.Router();

router.use(apiRateLimiter);

// Public routes
router.get("/", getHomepageSliders);
router.get("/:id", getHomepageSliderById);

// Admin routes
router.post("/", verifyJWT, authorizeRoles("admin"), upload.single("image"), createHomepageSlider);
router.patch("/:id", verifyJWT, authorizeRoles("admin"), upload.single("image"), updateHomepageSlider);
router.delete("/:id", verifyJWT, authorizeRoles("admin"), deleteHomepageSlider);
router.get("/admin/all", verifyJWT, authorizeRoles("admin"), getAllHomepageSliders);

export default router;

