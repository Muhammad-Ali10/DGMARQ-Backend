import express from "express";
import {
  createReturnRefund,
  getUserRefunds,
  getRefundById,
  getAllRefunds,
  updateRefundStatus,
  markManualRefund,
  cancelRefund,
  getCompletedOrdersForRefund,
  getOrderItemLicenseKeysForRefund,
  getSellerRefunds,
  sellerApproveRefund,
  sellerRejectRefund,
  sellerSubmitFeedback,
  escalateToAdmin,
  uploadRefundEvidence,
  addRefundMessage,
  getRefundMessages,
  requestSellerInput,
} from "../controller/returnrefund.controller.js";
import { verifyJWT } from "../middlerwares/authmiddlerware.js";
import { authorizeRoles } from "../middlerwares/authmiddlerware.js";
import { apiRateLimiter } from "../middlerwares/rateLimit.middlerware.js";
import { upload } from "../middlerwares/multer.middlerware.js";

// Purpose: Return and refund request management (refund-only; no disputes)

const router = express.Router();

router.use(apiRateLimiter);

// Evidence upload (before creating refund; returns URLs for evidenceFiles)
router.post("/upload-evidence", verifyJWT, authorizeRoles("customer", "admin"), upload.array("evidence", 5), uploadRefundEvidence);

// Customer
router.post("/", verifyJWT, authorizeRoles("customer", "admin"), createReturnRefund);
router.get("/my-refunds", verifyJWT, getUserRefunds);
router.get("/completed-orders", verifyJWT, getCompletedOrdersForRefund);
router.get("/order-item-keys", verifyJWT, getOrderItemLicenseKeysForRefund);
router.post("/:refundId/escalate", verifyJWT, authorizeRoles("customer", "admin"), escalateToAdmin);
router.get("/:refundId", verifyJWT, getRefundById);
router.delete("/:refundId", verifyJWT, cancelRefund);

// Refund chat (customer, seller when admin requested, admin)
router.get("/:refundId/messages", verifyJWT, getRefundMessages);
router.post("/:refundId/messages", verifyJWT, addRefundMessage);

// Seller (approve/reject for WALLET flow; optional advisory feedback)
router.get("/seller/list", verifyJWT, authorizeRoles("seller"), getSellerRefunds);
router.patch("/seller/:refundId/approve", verifyJWT, authorizeRoles("seller"), sellerApproveRefund);
router.patch("/seller/:refundId/reject", verifyJWT, authorizeRoles("seller"), sellerRejectRefund);
router.patch("/seller/:refundId/feedback", verifyJWT, authorizeRoles("seller"), sellerSubmitFeedback);

// Admin
router.get("/admin/all", verifyJWT, authorizeRoles("admin"), getAllRefunds);
router.patch("/admin/:refundId", verifyJWT, authorizeRoles("admin"), updateRefundStatus);
router.patch("/admin/:refundId/mark-manual-refund", verifyJWT, authorizeRoles("admin"), markManualRefund);
router.patch("/admin/:refundId/request-seller-input", verifyJWT, authorizeRoles("admin"), requestSellerInput);

export default router;

