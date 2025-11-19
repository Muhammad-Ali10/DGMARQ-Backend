import { Router } from "express";
import { verifyJWT, authorizeRoles } from "../middlerwares/authmiddlerware.js";
import { upload } from "../middlerwares/multer.middlerware.js";
import {
  createProduct,
  updateProductImages,
  deleteProduct,
  getProducts,
  updateProduct,
} from "../controller/product.controller.js";


const router = Router();

router.route("/create-product").post(
  verifyJWT,
  authorizeRoles("admin", "seller"),
  upload.array("images", 5),
  createProduct
);
router.route("/update-product-images/:id").patch(
  verifyJWT,
  authorizeRoles("admin", "seller"),
  upload.array("images", 5),
  updateProductImages
);
router.route("/delete-product/:id").delete(
  verifyJWT,
  authorizeRoles("admin", "seller"),
  deleteProduct
);
router.route("/update-product/:id").patch(
  verifyJWT,
  authorizeRoles("admin", "seller"),
  updateProduct
);

router.route("/get-products").get(getProducts);

export default router;
