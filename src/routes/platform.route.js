import { Router } from "express";
import {
  createPlatform,
  updatePlatform,
  deletePlatform, 
  getAllPlatforms,
  togglePlatformStatus,
} from "../controller/platform.controller.js";
import { verifyJWT, authorizeRoles } from "../middlerwares/authmiddlerware.js";

const router = Router();

router.post(
  "/create-platforms",
  verifyJWT,
  authorizeRoles("admin"),
  createPlatform
);

router.patch(
  "/update-platforms-name/:id",
  verifyJWT,
  authorizeRoles("admin"),
  updatePlatform
);

router.patch(
  "/update-platforms-status/:id/toggle-status",
  verifyJWT,
  authorizeRoles("admin"),
  togglePlatformStatus
);

router.delete(
  "/delete-platforms/:id",
  verifyJWT,
  authorizeRoles("admin"),
  deletePlatform
);

router.get(
  "/get-all-platforms",
  verifyJWT,
  getAllPlatforms
);

export default router;
