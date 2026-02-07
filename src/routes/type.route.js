import { Router } from "express";
import { authorizeRoles, verifyJWT, optionalJWT } from "../middlerwares/authmiddlerware.js";
import { createType, updateType, getAllTypes, deleteType, toggleTypeStatus   } from "../controller/type.controller.js";

// Purpose: Product type routes for creating, updating, deleting, and listing product types

const router = Router();

router.route("/create-product-type").post(verifyJWT, authorizeRoles("admin"), createType);       
router.route("/update-product-type/:id").patch(verifyJWT, authorizeRoles("admin"), updateType);
router.route("/delete-product-type/:id").delete(verifyJWT, authorizeRoles("admin"), deleteType);
router.route("/toggle-product-type-status/:id").patch(verifyJWT, authorizeRoles("admin"), toggleTypeStatus);
router.route("/get-all-product-types").get(optionalJWT, getAllTypes);

export default router;
