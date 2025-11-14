import { Router } from "express";
import { verifyJWT, authorizeRoles } from "../middlerwares/authmiddlerware.js";
import { upload } from "../middlerwares/multer.middlerware.js";
import {
  createProduct,
  updateProductImages,
  deleteProduct,
  getProducts,
} from "../controller/product.controller.js";


const router = Router();

router.post(
  "/create-product",
  verifyJWT,
  authorizeRoles("seller"),
  upload.fields([{ name: "images", maxCount: 5 }]),
  createProduct
);

router.patch(
  "/update-product-images/:id",
  verifyJWT,
  authorizeRoles("seller"),
  upload.fields([{ name: "images", maxCount: 5 }]),
  updateProductImages
);

router.delete(
  "/delete-product/:id",
  verifyJWT,
  authorizeRoles("seller"),
  deleteProduct
);

router.get("/get-products", getProducts);

export default router;
