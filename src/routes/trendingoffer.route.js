import express from "express";
import { verifyJWT, authorizeRoles } from "../middlerwares/authmiddlerware.js";
import {
  createTrendingOffer,
  getTrendingOffers,
  getTrendingOfferById,
  getOfferByProduct,
  updateTrendingOffer,
  deleteTrendingOffer,
  getAllTrendingOffers,
  updateAllStatuses,
} from "../controller/trendingoffer.controller.js";
import { apiRateLimiter } from "../middlerwares/rateLimit.middlerware.js";

// Purpose: Trending offer routes for public viewing and admin CRUD operations

const router = express.Router();

router.use(apiRateLimiter);

router.get("/", getTrendingOffers);
router.get("/product/:productId", getOfferByProduct);
router.get("/:id", getTrendingOfferById);

router.post("/", verifyJWT, authorizeRoles("admin"), createTrendingOffer);
router.patch("/:id", verifyJWT, authorizeRoles("admin"), updateTrendingOffer);
router.delete("/:id", verifyJWT, authorizeRoles("admin"), deleteTrendingOffer);
router.get("/admin/all", verifyJWT, authorizeRoles("admin"), getAllTrendingOffers);
router.post("/admin/update-statuses", verifyJWT, authorizeRoles("admin"), updateAllStatuses);

export default router;
