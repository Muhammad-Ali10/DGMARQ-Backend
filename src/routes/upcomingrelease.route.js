import express from "express";
import { verifyJWT, authorizeRoles } from "../middlerwares/authmiddlerware.js";
import { upload } from "../middlerwares/multer.middlerware.js";
import {
  getUpcomingReleases,
  getUpcomingReleasesConfig,
  updateSlot,
  updateSlotImage,
} from "../controller/upcomingrelease.controller.js";
import { apiRateLimiter } from "../middlerwares/rateLimit.middlerware.js";

// Purpose: Upcoming release routes for public viewing and admin slot management

const router = express.Router();

router.use(apiRateLimiter);

router.get("/", getUpcomingReleases);

router.get("/admin", verifyJWT, authorizeRoles("admin"), getUpcomingReleasesConfig);
router.put("/slot/:slotNumber", verifyJWT, authorizeRoles("admin"), updateSlot);
router.put("/slot/:slotNumber/image", verifyJWT, authorizeRoles("admin"), upload.single("backgroundImage"), updateSlotImage);

export default router;
