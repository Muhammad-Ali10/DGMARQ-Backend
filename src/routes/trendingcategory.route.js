import express from "express";
import { verifyJWT, authorizeRoles } from "../middlerwares/authmiddlerware.js";
import {
  getTrendingCategoriesHandler,
  getTrendingCategoryById,
  updateTrendingCategoriesHandler,
  getAllTrendingCategories,
} from "../controller/trendingcategory.controller.js";
import { apiRateLimiter } from "../middlerwares/rateLimit.middlerware.js";

const router = express.Router();

router.use(apiRateLimiter);

// Public routes
router.get("/", getTrendingCategoriesHandler);
router.get("/:id", getTrendingCategoryById);

// Admin routes
router.post("/update", verifyJWT, authorizeRoles("admin"), updateTrendingCategoriesHandler);
router.get("/admin/all", verifyJWT, authorizeRoles("admin"), getAllTrendingCategories);

export default router;

