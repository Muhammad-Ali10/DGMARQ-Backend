import express from "express";
import { verifyJWT, authorizeRoles } from "../middlerwares/authmiddlerware.js";
import {
  getUpcomingGames,
  getUpcomingGamesConfig,
  addProducts,
  removeProducts,
  reorderProducts,
  updateUpcomingGames,
} from "../controller/upcominggames.controller.js";
import { apiRateLimiter } from "../middlerwares/rateLimit.middlerware.js";

const router = express.Router();

router.use(apiRateLimiter);

// Public route
router.get("/", getUpcomingGames);

// Admin routes
router.get("/admin", verifyJWT, authorizeRoles("admin"), getUpcomingGamesConfig);
router.post("/add", verifyJWT, authorizeRoles("admin"), addProducts);
router.delete("/remove", verifyJWT, authorizeRoles("admin"), removeProducts);
router.put("/reorder", verifyJWT, authorizeRoles("admin"), reorderProducts);
router.put("/", verifyJWT, authorizeRoles("admin"), updateUpcomingGames);

export default router;
