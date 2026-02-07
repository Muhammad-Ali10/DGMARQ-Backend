import { Router } from "express";
import { verifyJWT, authorizeRoles, optionalJWT } from "../middlerwares/authmiddlerware.js";
import {
  createOrder,
  getOrders,
  getOrderById,
  getOrderKeys,
  cancelOrder,
  reorder,
  getSellerOrders,
} from "../controller/order.controller.js";

// Purpose: Order routes for customers, sellers, and admins to manage orders

const router = Router();

router.route("/create").post(createOrder);

router
  .route("/my-orders")
  .get(verifyJWT, authorizeRoles("customer", "admin"), getOrders);

router
  .route("/:orderId")
  .get(verifyJWT, authorizeRoles("customer", "admin", "seller"), getOrderById);

// License keys: optionalJWT allows guest access with ?guestEmail= for guest orders
router
  .route("/:orderId/keys")
  .get(optionalJWT, getOrderKeys);

router
  .route("/:orderId/cancel")
  .post(verifyJWT, authorizeRoles("customer", "admin"), cancelOrder);

router
  .route("/:orderId/reorder")
  .post(verifyJWT, authorizeRoles("customer", "admin"), reorder);

router
  .route("/seller/my-orders")
  .get(verifyJWT, authorizeRoles("seller"), getSellerOrders);

export default router;

