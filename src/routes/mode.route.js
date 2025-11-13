import { Router } from "express";
import { createMode, updateMode, toggleModeStatus, deleteMode, getAllModes  } from "../controller/mode.controller.js";
import { verifyJWT, authorizeRoles } from "../middlerwares/authmiddlerware.js";

const router = Router();

router.route("/create-mode").post(verifyJWT, authorizeRoles("admin"), createMode);
router.route("/update-mode/:id").patch(verifyJWT, authorizeRoles("admin"), updateMode);
router.route("/toggle-mode-status/:id").post(verifyJWT, authorizeRoles("admin"), toggleModeStatus); 
router.route("/delete-mode/:id").delete(verifyJWT, authorizeRoles("admin"), deleteMode);
router.route("/get-modes").get(getAllModes);


export default router;  