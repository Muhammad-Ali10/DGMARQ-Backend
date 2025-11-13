import { Router } from "express";
import { authorizeRoles, verifyJWT } from "../middlerwares/authmiddlerware.js";
import { createProductType, updateProductType, getAllProductTypes, deleteProductType, toggleProductTypeStatus   } from "../controller/type.controller.js";


const router = Router();

router.route("/create-product-type").post(verifyJWT, authorizeRoles("admin"), createProductType);       
router.route("/update-product-type/:id").patch(verifyJWT, authorizeRoles("admin"), updateProductType);
router.route("/delete-product-type/:id").delete(verifyJWT, authorizeRoles("admin"), deleteProductType);
router.route("/toggle-product-type-status/:id").patch(verifyJWT, authorizeRoles("admin"), toggleProductTypeStatus);
router.route("/get-all-product-types").get(verifyJWT, getAllProductTypes);

export default router;
