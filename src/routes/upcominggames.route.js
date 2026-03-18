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


const router = express.Router();

router.get("/", getUpcomingGames);

router.get("/admin", verifyJWT, authorizeRoles("admin"), getUpcomingGamesConfig);
router.post("/add", verifyJWT, authorizeRoles("admin"), addProducts);
router.delete("/remove", verifyJWT, authorizeRoles("admin"), removeProducts);
router.put("/reorder", verifyJWT, authorizeRoles("admin"), reorderProducts);
router.put("/", verifyJWT, authorizeRoles("admin"), updateUpcomingGames);

export default router;
