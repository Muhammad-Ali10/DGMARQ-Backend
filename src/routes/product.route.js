import { Router } from "express";
import { verifyJWT, authorizeRoles, optionalJWT } from "../middlerwares/authmiddlerware.js";
import { upload } from "../middlerwares/multer.middlerware.js";
import {
  createProduct,
  updateProductImages,
  deleteProduct,
  getProducts,
  getProductById,
  updateProduct,
  uploadKeys,
  getProductKeys,
  syncStock,
  duplicateProduct,
} from "../controller/product.controller.js";
import { getSoftwarePage } from "../controller/software.controller.js";


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

// Use optionalJWT to allow sellers to filter their own products
router.route("/get-products").get(optionalJWT, getProducts);

// Software page endpoint (public, optimized with caching)
router.route("/pages/software").get(getSoftwarePage);

// Get single product by ID or slug (must be before other :id routes)
router.route("/:identifier").get(getProductById);

router.route("/:id/upload-keys").post(
  verifyJWT,
  authorizeRoles("seller", "admin"),
  uploadKeys
);

router.route("/:id/keys").get(
  verifyJWT,
  authorizeRoles("seller", "admin"),
  getProductKeys
);

router.route("/:id/sync-stock").post(
  verifyJWT,
  authorizeRoles("seller", "admin"),
  syncStock
);

router.route("/:id/duplicate").post(
  verifyJWT,
  authorizeRoles("seller", "admin"),
  duplicateProduct
);

export default router;
