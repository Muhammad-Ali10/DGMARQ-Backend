import { Router } from "express";
import { authorizeRoles, verifyJWT } from "../middlerwares/authmiddlerware.js";
import { upload } from "../middlerwares/multer.middlerware.js";
import {createProduct, updateProduct, updateProductImages, deleteProduct} from "../controller/product.controller.js";


const router = Router()

router.route("/create-product").post(verifyJWT, authorizeRoles("seller"), upload.fields([
    { name: "images", maxCount: 5 },
]), createProduct)
router.route("/update-product/:id").patch(verifyJWT, authorizeRoles("seller"), updateProduct)
router.route("/update-product-images/:id").patch(verifyJWT, authorizeRoles("seller"), upload.fields([
    { name: "images", maxCount: 5 },
]), updateProductImages)
router.route("/delete-product/:id").delete(verifyJWT, authorizeRoles("seller"), deleteProduct)


export default router   

