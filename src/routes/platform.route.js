import { Router } from "express";
import { createPlatform, updatePlatform, deletePlatform, getAllPlatforms, togglePlatformStatus } from "../controller/platform.controller";
import { verifyJWT, authorizeRoles } from "../middlerwares/authmiddlerware";

const router = Router();

router.post("/platforms", verifyJWT, authorizeRoles("admin"), createPlatform);
router.put("/platforms/:id", verifyJWT, authorizeRoles("admin"), updatePlatform);
router.patch("/platforms/:id/toggle-status", verifyJWT, authorizeRoles("admin"), togglePlatformStatus);
router.delete("/platforms/:id", verifyJWT, authorizeRoles("admin"), deletePlatform);
router.get("/platforms", verifyJWT, getAllPlatforms);

export default router;