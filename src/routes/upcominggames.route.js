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

// Purpose: Upcoming games routes for public viewing and admin configuration

const router = express.Router();

router.use(apiRateLimiter);

router.get("/", getUpcomingGames);

router.get("/admin", verifyJWT, authorizeRoles("admin"), getUpcomingGamesConfig);
router.post("/add", verifyJWT, authorizeRoles("admin"), addProducts);
router.delete("/remove", verifyJWT, authorizeRoles("admin"), removeProducts);
router.put("/reorder", verifyJWT, authorizeRoles("admin"), reorderProducts);
router.put("/", verifyJWT, authorizeRoles("admin"), updateUpcomingGames);

export default router;
