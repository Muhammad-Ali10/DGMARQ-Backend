import { Router } from "express";
import { createMode, updateMode, toggleModeStatus, deleteMode, getAllModes  } from "../controller/mode.controller.js";
import { verifyJWT, authorizeRoles } from "../middlerwares/authmiddlerware.js";

// Purpose: Mode CRUD routes for admin management and public listing

const router = Router();

router.route("/create-mode").post(verifyJWT, authorizeRoles("admin"), createMode);
router.route("/update-mode/:modeId").patch(verifyJWT, authorizeRoles("admin"), updateMode);
router.route("/toggle-mode-status/:modeId").post(verifyJWT, authorizeRoles("admin"), toggleModeStatus); 
router.route("/delete-mode/:modeId").delete(verifyJWT, authorizeRoles("admin"), deleteMode);
router.route("/get-modes").get(getAllModes);

 
export default router;  