import { Router } from "express";
import { verifyJWT, authorizeRoles } from "../middlerwares/authmiddlerware.js";
import {
  addItemToCart,
  getCart,
  removeItemFromCart,
  clearCart,
  updateCart,
  addBundleToCart,
} from "../controller/cart.controller.js";

const router = Router();

router
  .route("/add-item")
  .post(verifyJWT, authorizeRoles("customer", "admin"), addItemToCart);

router
  .route("/get-cart")
  .get(verifyJWT, authorizeRoles("customer", "admin"), getCart);

router
  .route("/clear-cart")
  .patch(verifyJWT, authorizeRoles("customer", "admin"), clearCart);

router
  .route("/update-cart")
  .patch(verifyJWT, authorizeRoles("customer", "admin"), updateCart);

router
  .route("/remove-item")
  .patch(verifyJWT, authorizeRoles("customer", "admin"), removeItemFromCart);

router
  .route("/add-bundle")
  .post(verifyJWT, authorizeRoles("customer", "admin"), addBundleToCart);

export default router;
