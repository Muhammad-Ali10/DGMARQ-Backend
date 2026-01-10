import { Router } from "express";
import { verifyJWT, authorizeRoles } from "../middlerwares/authmiddlerware.js";
import {
  createOrder,
  getOrders,
  getOrderById,
  getOrderKeys,
  cancelOrder,
  reorder,
  getSellerOrders,
} from "../controller/order.controller.js";

const router = Router();

// Webhook endpoint for PayPal (no auth, verified by signature)
router.route("/create").post(createOrder);

// User endpoints
router
  .route("/my-orders")
  .get(verifyJWT, authorizeRoles("customer", "admin"), getOrders);

router
  .route("/:orderId")
  .get(verifyJWT, authorizeRoles("customer", "admin"), getOrderById);

router
  .route("/:orderId/keys")
  .get(verifyJWT, authorizeRoles("customer", "admin"), getOrderKeys);

router
  .route("/:orderId/cancel")
  .post(verifyJWT, authorizeRoles("customer", "admin"), cancelOrder);

router
  .route("/:orderId/reorder")
  .post(verifyJWT, authorizeRoles("customer", "admin"), reorder);

// Seller endpoints
router
  .route("/seller/my-orders")
  .get(verifyJWT, authorizeRoles("seller"), getSellerOrders);

export default router;

