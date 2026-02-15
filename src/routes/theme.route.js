import { Router } from "express";
import { createTheme, getThemes, updateTheme, deleteTheme  } from "../controller/theme.controller.js";
import { verifyJWT, authorizeRoles } from "../middlerwares/authmiddlerware.js";


const router = Router();

router.route("/create-theme").post(verifyJWT, authorizeRoles("admin"), createTheme);
router.route("/get-themes").get(getThemes);
router.route("/update-theme/:id").patch(verifyJWT, authorizeRoles("admin"), updateTheme);
router.route("/delete-theme/:id").delete(verifyJWT, authorizeRoles("admin"), deleteTheme);

export default router;
