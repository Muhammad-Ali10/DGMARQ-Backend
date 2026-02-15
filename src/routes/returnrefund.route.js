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


const router = express.Router();

router.use(apiRateLimiter);

router.post("/upload-evidence", verifyJWT, authorizeRoles("customer", "admin"), upload.array("evidence", 5), uploadRefundEvidence);

router.post("/", verifyJWT, authorizeRoles("customer", "admin"), createReturnRefund);
router.get("/my-refunds", verifyJWT, getUserRefunds);
router.get("/completed-orders", verifyJWT, getCompletedOrdersForRefund);
router.get("/order-item-keys", verifyJWT, getOrderItemLicenseKeysForRefund);
router.post("/:refundId/escalate", verifyJWT, authorizeRoles("customer", "admin"), escalateToAdmin);
router.get("/:refundId", verifyJWT, getRefundById);
router.delete("/:refundId", verifyJWT, cancelRefund);

router.get("/:refundId/messages", verifyJWT, getRefundMessages);
router.post("/:refundId/messages", verifyJWT, addRefundMessage);

router.get("/seller/list", verifyJWT, authorizeRoles("seller"), getSellerRefunds);
router.patch("/seller/:refundId/approve", verifyJWT, authorizeRoles("seller"), sellerApproveRefund);
router.patch("/seller/:refundId/reject", verifyJWT, authorizeRoles("seller"), sellerRejectRefund);
router.patch("/seller/:refundId/feedback", verifyJWT, authorizeRoles("seller"), sellerSubmitFeedback);

router.get("/admin/all", verifyJWT, authorizeRoles("admin"), getAllRefunds);
router.patch("/admin/:refundId", verifyJWT, authorizeRoles("admin"), updateRefundStatus);
router.patch("/admin/:refundId/mark-manual-refund", verifyJWT, authorizeRoles("admin"), markManualRefund);
router.patch("/admin/:refundId/request-seller-input", verifyJWT, authorizeRoles("admin"), requestSellerInput);

export default router;

