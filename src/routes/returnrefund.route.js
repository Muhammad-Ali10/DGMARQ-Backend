import express from "express";
import {
  createReturnRefund,
  getUserRefunds,
  getRefundById,
  getAllRefunds,
  updateRefundStatus,
  cancelRefund,
  getCompletedOrdersForRefund,
} from "../controller/returnrefund.controller.js";
import { verifyJWT } from "../middlerwares/authmiddlerware.js";
import { authorizeRoles } from "../middlerwares/authmiddlerware.js";
import { apiRateLimiter } from "../middlerwares/rateLimit.middlerware.js";

const router = express.Router();

// Apply rate limiting to all routes
router.use(apiRateLimiter);

// User routes
router.post("/", verifyJWT, createReturnRefund);
router.get("/my-refunds", verifyJWT, getUserRefunds);
router.get("/completed-orders", verifyJWT, getCompletedOrdersForRefund);
router.get("/:refundId", verifyJWT, getRefundById);
router.delete("/:refundId", verifyJWT, cancelRefund);

// Admin routes
router.get("/admin/all", verifyJWT, authorizeRoles("admin"), getAllRefunds);
router.patch("/admin/:refundId", verifyJWT, authorizeRoles("admin"), updateRefundStatus);

export default router;

