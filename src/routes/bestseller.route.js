import express from "express";
import {
  getBestsellers,
  getBestsellerByProduct,
  triggerBestSellerGeneration,
} from "../controller/bestseller.controller.js";
import { apiRateLimiter } from "../middlerwares/rateLimit.middlerware.js";
import { verifyJWT } from "../middlerwares/authmiddlerware.js";
import { authorizeRoles } from "../middlerwares/authmiddlerware.js";

const router = express.Router();

// Apply rate limiting to all routes
router.use(apiRateLimiter);

// Public routes
router.get("/", getBestsellers);
router.get("/product/:productId", getBestsellerByProduct);

// Admin route - only for triggering auto-generation (not manual selection)
router.post(
  "/generate",
  verifyJWT,
  authorizeRoles("admin"),
  triggerBestSellerGeneration
);

export default router;

