import { Router } from "express";
import { authorizeRoles, verifyJWT, optionalJWT } from "../middlerwares/authmiddlerware.js";
import { createType, updateType, getAllTypes, deleteType, toggleTypeStatus   } from "../controller/type.controller.js";


const router = Router();

router.route("/create-product-type").post(verifyJWT, authorizeRoles("admin"), createType);       
router.route("/update-product-type/:id").patch(verifyJWT, authorizeRoles("admin"), updateType);
router.route("/delete-product-type/:id").delete(verifyJWT, authorizeRoles("admin"), deleteType);
router.route("/toggle-product-type-status/:id").patch(verifyJWT, authorizeRoles("admin"), toggleTypeStatus);
// Public route - needed for product creation form
router.route("/get-all-product-types").get(optionalJWT, getAllTypes);

export default router;
