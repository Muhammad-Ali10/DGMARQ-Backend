import { Router } from "express";
import { verifyJWT, authorizeRoles } from "../middlerwares/authmiddlerware.js";
import { apiRateLimiter } from "../middlerwares/rateLimit.middlerware.js";
import { createOrder, captureOrder } from "../controller/paypalOrders.controller.js";

const router = Router();

// Apply rate limiting
router.use(apiRateLimiter);

// Create PayPal Order
router.post(
  "/orders",
  verifyJWT,
  authorizeRoles("customer", "admin"),
  createOrder
);

// Capture PayPal Order
router.post(
  "/orders/:orderId/capture",
  verifyJWT,
  authorizeRoles("customer", "admin"),
  captureOrder
);

export default router;

