import express from "express";
import { verifyJWT, authorizeRoles } from "../middlerwares/authmiddlerware.js";
import {
  getTrendingCategoriesHandler,
  getTrendingCategoryById,
  updateTrendingCategoriesHandler,
  getAllTrendingCategories,
} from "../controller/trendingcategory.controller.js";
import { apiRateLimiter } from "../middlerwares/rateLimit.middlerware.js";

// Purpose: Trending category routes for public viewing and admin management

const router = express.Router();

router.use(apiRateLimiter);

router.get("/", getTrendingCategoriesHandler);
router.get("/:id", getTrendingCategoryById);

router.post("/update", verifyJWT, authorizeRoles("admin"), updateTrendingCategoriesHandler);
router.get("/admin/all", verifyJWT, authorizeRoles("admin"), getAllTrendingCategories);

export default router;
