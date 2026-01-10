import { Router } from "express";
import {
  createRegion,
  updateRegion,
  deleteRegion,
  getRegions, 
  getRegionById,
} from "../controller/region.controller.js";
import { verifyJWT, authorizeRoles } from "../middlerwares/authmiddlerware.js";

const router = Router();
router
  .route("/create-region")
  .post(verifyJWT, authorizeRoles("admin"), createRegion);
router
  .route("/update-region/:regionId")
  .patch(verifyJWT, authorizeRoles("admin"), updateRegion);
router
  .route("/delete-region/:regionId")
  .delete(verifyJWT, authorizeRoles("admin"), deleteRegion);
router.route("/get-regions").get(getRegions);
router.route("/get-region/:regionId").get(getRegionById);

export default router;
