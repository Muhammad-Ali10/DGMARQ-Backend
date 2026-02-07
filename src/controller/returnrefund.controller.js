import mongoose from "mongoose";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { logger } from "../utils/logger.js";
import { ReturnRefund } from "../models/returnrefund.model.js";
import { Order } from "../models/order.model.js";
import { LicenseKey } from "../models/licensekey.model.js";
import { Product } from "../models/product.model.js";
import { Payout } from "../models/payout.model.js";
import { Seller } from "../models/seller.model.js";
import { auditLog } from "../services/audit.service.js";
import { REFUND_STATUS, REFUND_WINDOW_DAYS, PAYOUT_HOLD_DAYS, REFUND_METHOD } from "../constants.js";
import { creditWallet } from "../services/wallet.service.js";
import { getSellerBalance, adjustPayoutForRefund } from "../services/payout.service.js";
import { processRefund as processPayPalRefund } from "../services/payment.service.js";
import { Transaction } from "../models/transaction.model.js";

// Helper: append refund history entry
const pushRefundHistory = (refund, actor, action, previousStatus, newStatus, notes) => {
  if (!refund.refundHistory) refund.refundHistory = [];
  refund.refundHistory.push({
    actor,
    action,
    previousStatus: previousStatus || refund.status,
    newStatus: newStatus || refund.status,
    notes,
    timestamp: new Date(),
  });
};

// Order completion date (for refund/payout windows). Fallback: from payout holdUntil - 15 days, or order.updatedAt
const getOrderCompletionDate = (order) => {
  if (order?.orderCompletedAt) return new Date(order.orderCompletedAt);
  if (order?.updatedAt) return new Date(order.updatedAt);
  return order?.createdAt ? new Date(order.createdAt) : null;
};

// Refunds allowed only within REFUND_WINDOW_DAYS of order completion
const isWithinRefundWindow = (order) => {
  const completedAt = getOrderCompletionDate(order);
  if (!completedAt) return false;
  const now = new Date();
  const daysSince = (now - completedAt) / (24 * 60 * 60 * 1000);
  return daysSince <= REFUND_WINDOW_DAYS;
};

// True if order's payout is still held (within PAYOUT_HOLD_DAYS; money with platform, not yet released to seller)
const isPayoutHeldForOrder = async (orderId, session = null) => {
  const order = await Order.findById(orderId).session(session).select("orderCompletedAt updatedAt createdAt").lean();
  if (!order) return false;
  const completedAt = getOrderCompletionDate(order);
  if (!completedAt) return false;
  const now = new Date();
  const daysSince = (now.getTime() - completedAt.getTime()) / (24 * 60 * 60 * 1000);
  return daysSince <= PAYOUT_HOLD_DAYS;
};

const PAYPAL_EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Purpose: Creates a return/refund request (license-key level; refund method WALLET or ORIGINAL_PAYMENT)
const createReturnRefund = asyncHandler(async (req, res) => {
  const { orderId, productId, reason, licenseKeyIds: rawLicenseKeyIds, evidenceFiles, refundMethod: rawRefundMethod, customerPayPalEmail } = req.body;
  const userId = req.user._id;

  if (!orderId || !productId || !reason) {
    throw new ApiError(400, "Order ID, product ID, and reason are required");
  }
  const refundMethod = (rawRefundMethod || "WALLET").toUpperCase();
  if (!REFUND_METHOD.includes(refundMethod)) {
    throw new ApiError(400, "refundMethod must be WALLET or MANUAL");
  }
  const isManualRefund = refundMethod === "ORIGINAL_PAYMENT" || refundMethod === "MANUAL";
  if (isManualRefund) {
    if (!customerPayPalEmail || typeof customerPayPalEmail !== "string" || !customerPayPalEmail.trim()) {
      throw new ApiError(400, "PayPal email is required for refund to original payment method");
    }
    if (!PAYPAL_EMAIL_REGEX.test(customerPayPalEmail.trim())) {
      throw new ApiError(400, "Invalid PayPal email format");
    }
  }
  const evidenceUrls = Array.isArray(evidenceFiles) ? evidenceFiles.filter((u) => typeof u === "string" && u.trim()) : [];
  if (evidenceUrls.length === 0) {
    throw new ApiError(400, "At least one evidence image is required. Please upload error screenshots or proof.");
  }

  if (!mongoose.Types.ObjectId.isValid(orderId) || !mongoose.Types.ObjectId.isValid(productId)) {
    throw new ApiError(400, "Invalid order ID or product ID");
  }

  const order = await Order.findOne({
    _id: orderId,
    userId,
    paymentStatus: "paid",
    orderStatus: "completed",
  }).populate("items.productId", "productType sellerId");

  if (!order) {
    throw new ApiError(404, "Order not found or not eligible for refund. Only completed orders can be refunded.");
  }

  if (!isWithinRefundWindow(order)) {
    const completedAt = getOrderCompletionDate(order);
    const daysSince = completedAt ? Math.floor((Date.now() - completedAt.getTime()) / (24 * 60 * 60 * 1000)) : 0;
    const message = daysSince >= PAYOUT_HOLD_DAYS
      ? "Refund period expired. Payout already released."
      : "Refund period expired. Refunds are allowed only within 10 days of order completion.";
    throw new ApiError(400, message);
  }

  const productIdStr = productId.toString().trim();
  const normalizeProductId = (pid) => {
    if (!pid) return null;
    if (pid._id) return pid._id.toString().trim();
    if (typeof pid === "object" && pid.toString) return pid.toString().trim();
    return String(pid).trim();
  };

  const orderItem = order.items.find((item) => normalizeProductId(item.productId) === productIdStr);
  if (!orderItem) {
    throw new ApiError(404, "Product not found in this order");
  }
  if (orderItem.refunded) {
    throw new ApiError(400, "This product has already been refunded");
  }

  const assignedKeyIds = (orderItem.assignedKeyIds || []).map((id) => id?.toString?.() || id);
  let licenseKeyIds = Array.isArray(rawLicenseKeyIds) ? rawLicenseKeyIds.map((id) => String(id).trim()) : [];
  if (licenseKeyIds.length === 0) {
    licenseKeyIds = [...assignedKeyIds];
  }
  if (licenseKeyIds.length === 0) {
    throw new ApiError(400, "No license keys to refund for this item");
  }
  const invalidKeys = licenseKeyIds.filter((id) => !assignedKeyIds.includes(id));
  if (invalidKeys.length > 0) {
    throw new ApiError(400, "Selected key(s) do not belong to this order item");
  }

  const licenseKeyDoc = await LicenseKey.findOne({ productId: new mongoose.Types.ObjectId(productId) }).select("keys");
  if (licenseKeyDoc) {
    for (const keyId of licenseKeyIds) {
      const key = licenseKeyDoc.keys.id(keyId);
      if (key?.isRefunded) {
        throw new ApiError(400, "One or more selected keys are already refunded");
      }
    }
  }

  const existingForSameKey = await ReturnRefund.findOne({
    orderId,
    productId,
    userId,
    status: { $in: ["PENDING", "SELLER_REVIEW", "SELLER_APPROVED", "ADMIN_REVIEW", "ADMIN_APPROVED", "pending", "approved"] },
    licenseKeyIds: { $in: licenseKeyIds.map((id) => new mongoose.Types.ObjectId(id)) },
  });
  if (existingForSameKey) {
    throw new ApiError(400, "A refund request already exists for one or more of these license keys");
  }

  const sellerId = orderItem.sellerId?._id || orderItem.sellerId;
  if (!sellerId) {
    throw new ApiError(400, "Seller ID not found in order item");
  }
  const actualProductId = orderItem.productId?._id || orderItem.productId;
  const actualOrderId = order._id;
  const actualSellerId = orderItem.sellerId?._id || orderItem.sellerId;

  // All refund requests go to admin; seller cannot approve or reject
  const initialStatus = "ADMIN_REVIEW";
  const initialStage = "ADMIN_REVIEW";

  const returnRefund = await ReturnRefund.create({
    orderId: new mongoose.Types.ObjectId(actualOrderId),
    productId: new mongoose.Types.ObjectId(actualProductId),
    userId: new mongoose.Types.ObjectId(userId),
    sellerId: new mongoose.Types.ObjectId(actualSellerId),
    reason: reason.trim(),
    status: initialStatus,
    currentStage: initialStage,
    refundMethod: isManualRefund ? (refundMethod === "MANUAL" ? "ORIGINAL_PAYMENT" : refundMethod) : "WALLET",
    customerPayPalEmail: isManualRefund ? customerPayPalEmail.trim() : null,
    licenseKeyIds: licenseKeyIds.map((id) => new mongoose.Types.ObjectId(id)),
    evidenceFiles: evidenceUrls,
    sellerReviewStartedAt: isManualRefund ? null : new Date(),
    refundHistory: [
      {
        actor: "customer",
        action: isManualRefund ? "REFUND_REQUESTED_ADMIN_HANDLED" : "REFUND_REQUESTED",
        previousStatus: null,
        newStatus: initialStatus,
        notes: isManualRefund ? "Customer requested refund to original payment (manual). Admin will review." : `Refund requested for ${licenseKeyIds.length} key(s). Admin will review.`,
        timestamp: new Date(),
      },
    ],
  });

  await auditLog(userId, "REFUND_REQUESTED", `Refund requested for order ${actualOrderId}, product ${actualProductId}`, {
    returnRefundId: returnRefund._id,
    orderId: actualOrderId,
    productId: actualProductId,
    sellerId: actualSellerId,
    licenseKeyIds: returnRefund.licenseKeyIds,
  });

  return res.status(201).json(
    new ApiResponse(201, returnRefund, "Refund request created successfully. Admin will review.")
  );
});

// Purpose: Retrieves user's refund requests with pagination and optional status filtering
const getUserRefunds = asyncHandler(async (req, res) => {
  const userId = req.user._id;
  const { page = 1, limit = 10, status } = req.query;

  const match = { userId };
  if (status) {
    match.status = status;
  }

  const refunds = await ReturnRefund.find(match)
    .populate("orderId", "totalAmount createdAt orderStatus")
    .populate("productId", "name images price productType")
    .populate("sellerId", "shopName")
    .sort({ createdAt: -1 })
    .skip((page - 1) * limit)
    .limit(parseInt(limit));

  const total = await ReturnRefund.countDocuments(match);

  return res.status(200).json(
    new ApiResponse(200, {
      refunds,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit),
      },
    }, "Refund requests retrieved successfully")
  );
});

// Purpose: Retrieves a refund request by ID with access verification
const getRefundById = asyncHandler(async (req, res) => {
  const { refundId } = req.params;
  const userId = req.user._id;

  if (!mongoose.Types.ObjectId.isValid(refundId)) {
    throw new ApiError(400, "Invalid refund ID");
  }

  const refund = await ReturnRefund.findById(refundId)
    .populate("orderId", "totalAmount createdAt orderStatus items")
    .populate("productId", "name images price productType")
    .populate("sellerId", "shopName")
    .populate("userId", "name email");

  if (!refund) {
    throw new ApiError(404, "Refund request not found");
  }

  const refundUserId = refund.userId?._id || refund.userId;
  const refundSellerId = refund.sellerId?._id || refund.sellerId;
  const isOwner = refundUserId && refundUserId.toString() === userId.toString();
  const isAdmin = req.user.roles?.includes("admin");
  const seller = await Seller.findOne({ userId }).select("_id");
  const isSeller = seller && refundSellerId && refundSellerId.toString() === seller._id.toString();

  if (!isOwner && !isAdmin && !isSeller) {
    throw new ApiError(403, "You don't have access to this refund request");
  }

  return res.status(200).json(
    new ApiResponse(200, refund, "Refund request retrieved successfully")
  );
});

// Purpose: Retrieves all refund requests with pagination and optional status filtering for admin
const getAllRefunds = asyncHandler(async (req, res) => {
  if (!req.user.roles?.includes("admin")) {
    throw new ApiError(403, "Only admins can view all refund requests");
  }

  const { page = 1, limit = 10, status } = req.query;

  const match = {};
  if (status) {
    match.status = status;
  }

  const refunds = await ReturnRefund.find(match)
    .populate("userId", "name email")
    .populate("orderId", "totalAmount createdAt orderStatus")
    .populate("productId", "name images price productType")
    .populate("sellerId", "shopName")
    .sort({ createdAt: -1 })
    .skip((page - 1) * limit)
    .limit(parseInt(limit));

  const total = await ReturnRefund.countDocuments(match);

  return res.status(200).json(
    new ApiResponse(200, {
      refunds,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit),
      },
    }, "All refund requests retrieved successfully")
  );
});

// Purpose: Updates refund status and processes refund if approved (admin only)
const updateRefundStatus = asyncHandler(async (req, res) => {
  if (!req.user.roles?.includes("admin")) {
    throw new ApiError(403, "Only admins can update refund status");
  }

  const { refundId } = req.params;
  const { status, adminNotes, rejectionReason } = req.body;

  if (!mongoose.Types.ObjectId.isValid(refundId)) {
    throw new ApiError(400, "Invalid refund ID");
  }

  const allowedAdminStatuses = [...REFUND_STATUS, "approved", "rejected"];
  if (!status || !allowedAdminStatuses.includes(status)) {
    throw new ApiError(400, "Valid status is required");
  }

  if (["rejected", "ADMIN_REJECTED"].includes(status) && !rejectionReason?.trim()) {
    throw new ApiError(400, "Rejection reason is required when rejecting a refund request");
  }

  const refund = await ReturnRefund.findById(refundId)
    .populate("orderId")
    .populate("productId", "productType");

  if (!refund) {
    throw new ApiError(404, "Refund request not found");
  }

  const getObjectId = (field) => {
    if (!field) return null;
    if (field._id) return field._id;
    if (mongoose.Types.ObjectId.isValid(field)) return field;
    return null;
  };

  if (refund.status === "COMPLETED" || refund.status === "completed") {
    throw new ApiError(400, "This refund has already been completed and cannot be modified");
  }
  if (["rejected", "ADMIN_REJECTED", "SELLER_REJECTED"].includes(refund.status) && !["rejected", "ADMIN_REJECTED"].includes(status)) {
    throw new ApiError(400, "A rejected refund cannot be changed to another status");
  }

  // Admin approves refund (full authority; can jump at ANY time from PENDING, SELLER_REVIEW, SELLER_APPROVED, or ADMIN_REVIEW). Skip for ORIGINAL_PAYMENT (use mark-manual-refund).
  if (status === "ADMIN_APPROVED") {
    if (refund.refundMethod === "ORIGINAL_PAYMENT") {
      throw new ApiError(400, "Use 'Mark as Refunded (Manual)' after sending the refund via PayPal. This refund is to original payment method.");
    }
    const allowedForAdminApprove = ["PENDING", "SELLER_REVIEW", "SELLER_APPROVED", "ADMIN_REVIEW"];
    if (!allowedForAdminApprove.includes(refund.status)) {
      throw new ApiError(400, `Refund cannot be approved in status ${refund.status}`);
    }
    const orderForWindow = await Order.findById(refund.orderId).select("orderCompletedAt updatedAt createdAt").lean();
    if (!orderForWindow || !isWithinRefundWindow(orderForWindow)) {
      throw new ApiError(400, "Refund period expired. Refunds are allowed only within 10 days of order completion.");
    }
    await auditLog(req.user._id, "REFUND_ADMIN_APPROVED", `Admin approved refund ${refundId}`, {
      refundId,
      adminId: req.user._id,
      timestamp: new Date(),
    });
    const result = await processRefundExecution(refund, req.user._id, "admin");
    if (result.hold) {
      refund.status = "ON_HOLD_INSUFFICIENT_FUNDS";
      pushRefundHistory(refund, "admin", "REFUND_ON_HOLD", "ADMIN_REVIEW", "ON_HOLD_INSUFFICIENT_FUNDS", "Insufficient seller balance (payout already released)");
      await refund.save();
      await auditLog(req.user._id, "REFUND_ON_HOLD", `Refund ${refundId} on hold: insufficient seller balance`, {
        actor: "admin",
        action: "REFUND_ON_HOLD",
        refundId,
        refundStatus: "ON_HOLD_INSUFFICIENT_FUNDS",
        payoutStatus: "RELEASED",
        timestamp: new Date(),
        notes: "Insufficient seller balance. Only occurs after payout release.",
      });
      return res.status(400).json(
        new ApiResponse(400, { refund, hold: true }, "Refund cannot be processed: insufficient seller balance. Refund is on hold.")
      );
    }
    const updated = await ReturnRefund.findById(refundId)
      .populate("userId", "name email")
      .populate("orderId", "totalAmount createdAt orderStatus")
      .populate("productId", "name images price productType")
      .populate("sellerId", "shopName");
    return res.status(200).json(
      new ApiResponse(200, { refund: updated, walletBalance: result.walletBalance }, "Refund approved and processed successfully.")
    );
  }

  if (status === "ADMIN_REJECTED") {
    const allowedForReject = ["ADMIN_REVIEW", "ON_HOLD_INSUFFICIENT_FUNDS"];
    if (!allowedForReject.includes(refund.status)) {
      throw new ApiError(400, `Refund must be in ADMIN_REVIEW or ON_HOLD_INSUFFICIENT_FUNDS to reject. Current status: ${refund.status}`);
    }
    if (!rejectionReason?.trim()) {
      throw new ApiError(400, "Rejection reason is required");
    }
    const prev = refund.status;
    refund.status = "ADMIN_REJECTED";
    refund.rejectionReason = rejectionReason;
    refund.adminNotes = adminNotes || "Refund rejected by admin (final decision)";
    pushRefundHistory(refund, "admin", "ADMIN_REJECTED", prev, "ADMIN_REJECTED", rejectionReason);
    await refund.save();
    await refund.populate("userId", "name email").populate("orderId", "totalAmount createdAt orderStatus").populate("productId", "name images price productType").populate("sellerId", "shopName");
    await auditLog(req.user._id, "REFUND_ADMIN_REJECTED", `Refund ${refundId} rejected by admin`, { refundId, rejectionReason });
    return res.status(200).json(new ApiResponse(200, refund, "Refund request rejected (final decision)."));
  }

  if (status === "approved") {
    const allowedForLegacyApprove = ["pending", "PENDING", "SELLER_REVIEW", "SELLER_APPROVED", "ADMIN_REVIEW"];
    if (!allowedForLegacyApprove.includes(refund.status)) {
      throw new ApiError(400, `Refund cannot be approved in status ${refund.status}`);
    }
    if (refund.refundMethod === "ORIGINAL_PAYMENT") {
      throw new ApiError(400, "Use 'Mark as Refunded (Manual)' for manual PayPal refunds.");
    }
    const orderForWindow = await Order.findById(refund.orderId).select("orderCompletedAt updatedAt createdAt").lean();
    if (!orderForWindow || !isWithinRefundWindow(orderForWindow)) {
      throw new ApiError(400, "Refund period expired. Refunds are allowed only within 10 days of order completion.");
    }
    const result = await processRefundExecution(refund, req.user._id, "admin");
    if (result.hold) {
      refund.status = "ON_HOLD_INSUFFICIENT_FUNDS";
      pushRefundHistory(refund, "admin", "REFUND_ON_HOLD", refund.status, "ON_HOLD_INSUFFICIENT_FUNDS", "Insufficient seller balance (payout already released)");
      await refund.save();
      return res.status(400).json(
        new ApiResponse(400, { refund, hold: true }, "Refund cannot be processed: insufficient seller balance. Refund is on hold.")
      );
    }
    const updated = await ReturnRefund.findById(refundId)
      .populate("userId", "name email")
      .populate("orderId", "totalAmount createdAt orderStatus")
      .populate("productId", "name images price productType")
      .populate("sellerId", "shopName");
    return res.status(200).json(
      new ApiResponse(200, { refund: updated, walletBalance: result.walletBalance }, "Refund processed successfully. Wallet has been credited.")
    );
  }

  if (status === "rejected") {
    if (refund.status === "completed") {
      throw new ApiError(400, "Cannot reject a refund that has already been completed");
    }
    if (refund.status === "rejected") {
      throw new ApiError(400, "This refund has already been rejected");
    }

    refund.status = "rejected";
    refund.rejectionReason = rejectionReason;
    refund.adminNotes = adminNotes || "Refund request rejected";
    await refund.save();

    await refund.populate("userId", "name email");
    await refund.populate("orderId", "totalAmount createdAt orderStatus");
    await refund.populate("productId", "name images price productType");
    await refund.populate("sellerId", "shopName");

    await auditLog(req.user._id, "REFUND_REJECTED", `Refund ${refundId} rejected`, {
      refundId,
      rejectionReason,
      adminId: req.user._id,
    });

    return res.status(200).json(
      new ApiResponse(200, refund, "Refund request rejected successfully")
    );
  } else {
    const updatedRefund = await ReturnRefund.findByIdAndUpdate(
      refundId,
      { status, adminNotes },
      { new: true }
    )
      .populate("userId", "name email")
      .populate("orderId", "totalAmount createdAt orderStatus")
      .populate("productId", "name images price productType")
      .populate("sellerId", "shopName");

    await auditLog(req.user._id, "REFUND_UPDATED", `Refund ${refundId} status updated to ${status}`, {
      refundId,
      status,
      adminId: req.user._id,
    });

    return res.status(200).json(
      new ApiResponse(200, updatedRefund, "Refund status updated successfully")
    );
  }
});

// Purpose: Cancels a pending refund request (user only)
const cancelRefund = asyncHandler(async (req, res) => {
  const { refundId } = req.params;
  const userId = req.user._id;

  if (!mongoose.Types.ObjectId.isValid(refundId)) {
    throw new ApiError(400, "Invalid refund ID");
  }

  const refund = await ReturnRefund.findById(refundId);
  if (!refund) {
    throw new ApiError(404, "Refund request not found");
  }

  if (refund.userId.toString() !== userId.toString()) {
    throw new ApiError(403, "You can only cancel your own refund requests");
  }

  const cancellableStatuses = ["PENDING", "ADMIN_REVIEW", "SELLER_REVIEW", "pending"];
  if (!cancellableStatuses.includes(refund.status)) {
    throw new ApiError(400, "Only refund requests awaiting review can be cancelled");
  }

  await ReturnRefund.findByIdAndDelete(refundId);

  await auditLog(userId, "REFUND_CANCELLED", `Refund ${refundId} cancelled by user`, {
    refundId,
  });

  return res.status(200).json(
    new ApiResponse(200, null, "Refund request cancelled successfully")
  );
});

// Purpose: Execute refund (deduct seller, credit customer, mark keys). Returns { hold: true } if seller balance insufficient.
const processRefundExecution = async (refund, actorUserId, actorRole) => {
  const getObjectId = (field) => {
    if (!field) return null;
    if (field._id) return field._id;
    if (mongoose.Types.ObjectId.isValid(field)) return field;
    return null;
  };
  const orderId = getObjectId(refund.orderId);
  const productId = getObjectId(refund.productId);
  const userId = getObjectId(refund.userId);
  const sellerId = getObjectId(refund.sellerId);
  if (!orderId || !productId || !userId || !sellerId) {
    throw new ApiError(400, "Invalid refund data: missing required IDs");
  }

  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const order = await Order.findById(orderId).session(session);
    if (!order) throw new ApiError(404, "Order not found");
    if (order.paymentStatus !== "paid") throw new ApiError(400, "Order is not paid");
    if (order.orderStatus !== "completed") throw new ApiError(400, "Only completed orders can be refunded");

    const productIdStr = productId.toString();
    let orderItem = order.items.find((item) => {
      const pid = item.productId?.toString?.() || item.productId?._id?.toString?.();
      return pid === productIdStr;
    });
    if (!orderItem) throw new ApiError(404, "Product not found in this order");

    const keyIdsToRefund = Array.isArray(refund.licenseKeyIds) && refund.licenseKeyIds.length > 0
      ? refund.licenseKeyIds.map((id) => getObjectId(id))
      : (orderItem.assignedKeyIds || []).slice();

    const qty = orderItem.qty || 1;
    const unitPrice = orderItem.unitPrice || 0;
    const lineTotal = orderItem.lineTotal || 0;
    const sellerEarningTotal = orderItem.sellerEarning || 0;
    const sellerEarningPerUnit = qty > 0 ? sellerEarningTotal / qty : 0;
    const keyCount = keyIdsToRefund.length;
    const refundAmount = keyCount > 0 ? Math.round(unitPrice * keyCount * 100) / 100 : lineTotal;
    const sellerEarning = keyCount > 0 ? Math.round(sellerEarningPerUnit * keyCount * 100) / 100 : sellerEarningTotal;

    if (refundAmount <= 0) {
      await session.abortTransaction();
      session.endSession();
      throw new ApiError(400, "Invalid refund amount");
    }

    const payoutHeld = await isPayoutHeldForOrder(orderId, session);
    if (!payoutHeld) {
      const sellerBalance = await getSellerBalance(sellerId);
      const available = sellerBalance?.available ?? 0;
      if (available < sellerEarning) {
        await session.abortTransaction();
        session.endSession();
        return { hold: true };
      }
    }

    refund.refundAmount = refundAmount;
    const payoutStatus = payoutHeld ? "HELD" : "RELEASED";

    let paypalRefundResult = null;
    if (order.paypalCaptureId && order.paymentMethod === "PayPal") {
      try {
        paypalRefundResult = await processPayPalRefund(
          order.paypalCaptureId,
          refundAmount,
          order.currency || "USD"
        );
        refund.refundTransactionId = paypalRefundResult?.id || null;
        await Transaction.create([{
          userId,
          orderId: order._id,
          type: "refund",
          amount: refundAmount,
          currency: order.currency || "USD",
          status: paypalRefundResult?.status === "COMPLETED" ? "completed" : "pending",
          paymentMethod: "PayPal",
          paypalTransactionId: paypalRefundResult?.id,
          paypalCaptureId: order.paypalCaptureId,
          description: `PayPal refund for order ${order._id}, product ${productId}`,
          metadata: { refundId: refund._id, productId },
        }], { session });
      } catch (paypalErr) {
        const msg = paypalErr.message || "";
        if (!msg.includes("CAPTURE_FULLY_REFUNDED") && !msg.includes("already been fully refunded")) {
          refund.adminNotes = (refund.adminNotes || "") + ` PayPal refund failed: ${msg}. `;
        }
      }
    }

    const commissionPerUnit = qty > 0 ? (orderItem.lineTotal - sellerEarningTotal) / qty : 0;
    const refundCommission = keyCount > 0 ? Math.round(commissionPerUnit * keyCount * 100) / 100 : 0;
    if (payoutHeld) {
      await adjustPayoutForRefund(
        order._id,
        sellerId,
        refundAmount,
        refundCommission,
        sellerEarning,
        keyIdsToRefund.map((id) => id?.toString?.() || id),
        session
      );
    } else {
      await Payout.create([{
        sellerId,
        orderId: order._id,
        requestType: "scheduled",
        grossAmount: -refundAmount,
        commissionAmount: -refundCommission,
        netAmount: -sellerEarning,
        currency: "USD",
        status: "blocked",
        notes: `Refund deduction for order ${order._id}, product ${productId} (${actorRole} approved)`,
      }], { session });
    }

    await creditWallet(
      userId,
      refundAmount,
      `Refund for order ${order._id}, product ${refund.productId?.name || "Product"}`,
      { orderId: order._id, refundId: refund._id, productId },
      session
    );

    if (keyIdsToRefund.length > 0) {
      await LicenseKey.updateOne(
        { productId },
        {
          $set: {
            "keys.$[key].isRefunded": true,
            "keys.$[key].refundedAt": new Date(),
            "keys.$[key].isUsed": true,
          },
        },
        { arrayFilters: [{ "key._id": { $in: keyIdsToRefund } }], session }
      );
    }

    const round2 = (v) => Math.round(Number(v) * 100) / 100;
    const itemIndex = order.items.findIndex((item) => {
      const pid = item.productId?.toString?.() || item.productId?._id?.toString?.();
      return pid === productIdStr;
    });
    if (itemIndex >= 0) {
      const item = order.items[itemIndex];
      order.items[itemIndex].refundedKeysCount = (item.refundedKeysCount || 0) + keyCount;
      order.items[itemIndex].refundedAmount = round2((item.refundedAmount || 0) + refundAmount);
      order.items[itemIndex].refundedSellerAmount = round2((item.refundedSellerAmount || 0) + sellerEarning);
      const allKeyIds = item.assignedKeyIds || [];
      if (allKeyIds.length > 0) {
        const licenseKeyDoc = await LicenseKey.findOne({ productId }).session(session).select("keys");
        const allRefunded = licenseKeyDoc && allKeyIds.every((kid) => {
          const k = licenseKeyDoc.keys.id(kid);
          return k && (k.isRefunded || k.isUsed);
        });
        if (allRefunded) {
          order.items[itemIndex].refunded = true;
          order.items[itemIndex].refundedAt = new Date();
        }
      } else {
        order.items[itemIndex].refunded = true;
        order.items[itemIndex].refundedAt = new Date();
      }
    }

    const allItemsRefunded = order.items.every((item) => item.refunded);
    if (allItemsRefunded) {
      order.paymentStatus = "refunded";
      order.orderStatus = "returned";
    } else {
      order.orderStatus = "partially_completed";
    }
    await order.save({ session });

    refund.status = "COMPLETED";
    refund.refundedAt = new Date();
    pushRefundHistory(refund, actorRole, "REFUND_COMPLETED", refund.status, "COMPLETED", "Refund processed");
    await refund.save({ session });

    await session.commitTransaction();
    session.endSession();

    const { getWalletBalance } = await import("../services/wallet.service.js");
    const finalWalletBalance = await getWalletBalance(userId);
    await auditLog(actorUserId, "REFUND_COMPLETED", `Refund ${refund._id} completed (${actorRole})`, {
      actor: actorRole,
      action: "REFUND_COMPLETED",
      refundId: refund._id,
      refundStatus: "COMPLETED",
      payoutStatus,
      orderId,
      productId,
      sellerId,
      refundAmount,
      walletBalance: finalWalletBalance,
      timestamp: new Date(),
      notes: payoutHeld ? "Deducted from seller pending (payout still held)" : "Deducted from seller available balance",
    });
    return { walletBalance: finalWalletBalance };
  } catch (err) {
    if (session.inTransaction()) await session.abortTransaction();
    session.endSession();
    throw err;
  }
};

// Purpose: Complete manual PayPal refund (admin sent refund via PayPal dashboard). Deduct seller, invalidate keys, NO wallet credit.
const processManualRefundCompletion = async (refund, adminUserId, manualRefundReference = null) => {
  const getObjectId = (field) => {
    if (!field) return null;
    if (field._id) return field._id;
    if (mongoose.Types.ObjectId.isValid(field)) return field;
    return null;
  };
  const orderId = getObjectId(refund.orderId);
  const productId = getObjectId(refund.productId);
  const sellerId = getObjectId(refund.sellerId);
  if (!orderId || !productId || !sellerId) throw new ApiError(400, "Invalid refund data");

  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const order = await Order.findById(orderId).session(session);
    if (!order) throw new ApiError(404, "Order not found");
    const productIdStr = productId.toString();
    const orderItem = order.items.find((item) => (item.productId?.toString?.() || item.productId?._id?.toString?.()) === productIdStr);
    if (!orderItem) throw new ApiError(404, "Product not found in this order");

    const keyIdsToRefund = Array.isArray(refund.licenseKeyIds) && refund.licenseKeyIds.length > 0
      ? refund.licenseKeyIds.map((id) => getObjectId(id))
      : (orderItem.assignedKeyIds || []).slice();
    const qty = orderItem.qty || 1;
    const unitPrice = orderItem.unitPrice || 0;
    const sellerEarningTotal = orderItem.sellerEarning || 0;
    const sellerEarningPerUnit = qty > 0 ? sellerEarningTotal / qty : 0;
    const keyCount = keyIdsToRefund.length;
    const refundAmount = keyCount > 0 ? Math.round(unitPrice * keyCount * 100) / 100 : orderItem.lineTotal;
    const sellerEarning = keyCount > 0 ? Math.round(sellerEarningPerUnit * keyCount * 100) / 100 : sellerEarningTotal;
    if (refundAmount <= 0) throw new ApiError(400, "Invalid refund amount");

    const payoutHeld = await isPayoutHeldForOrder(orderId, session);
    if (!payoutHeld) {
      const sellerBalance = await getSellerBalance(sellerId);
      if ((sellerBalance?.available ?? 0) < sellerEarning) {
        await session.abortTransaction();
        session.endSession();
        return { hold: true };
      }
    }

    refund.refundAmount = refundAmount;
    const commissionPerUnit = qty > 0 ? (orderItem.lineTotal - sellerEarningTotal) / qty : 0;
    const refundCommission = keyCount > 0 ? Math.round(commissionPerUnit * keyCount * 100) / 100 : 0;
    if (payoutHeld) {
      await adjustPayoutForRefund(
        order._id,
        sellerId,
        refundAmount,
        refundCommission,
        sellerEarning,
        keyIdsToRefund.map((id) => id?.toString?.() || id),
        session
      );
    } else {
      await Payout.create([{
        sellerId,
        orderId: order._id,
        requestType: "scheduled",
        grossAmount: -refundAmount,
        commissionAmount: -refundCommission,
        netAmount: -sellerEarning,
        currency: "USD",
        status: "blocked",
        notes: `Manual refund deduction for order ${order._id}, product ${productId} (admin completed)`,
      }], { session });
    }

    if (keyIdsToRefund.length > 0) {
      await LicenseKey.updateOne(
        { productId },
        { $set: { "keys.$[key].isRefunded": true, "keys.$[key].refundedAt": new Date(), "keys.$[key].isUsed": true } },
        { arrayFilters: [{ "key._id": { $in: keyIdsToRefund } }], session }
      );
    }

    const round2 = (v) => Math.round(Number(v) * 100) / 100;
    const itemIndex = order.items.findIndex((item) => (item.productId?.toString?.() || item.productId?._id?.toString?.()) === productIdStr);
    if (itemIndex >= 0) {
      const item = order.items[itemIndex];
      order.items[itemIndex].refundedKeysCount = (item.refundedKeysCount || 0) + keyCount;
      order.items[itemIndex].refundedAmount = round2((item.refundedAmount || 0) + refundAmount);
      order.items[itemIndex].refundedSellerAmount = round2((item.refundedSellerAmount || 0) + sellerEarning);
      const allKeyIds = item.assignedKeyIds || [];
      if (allKeyIds.length > 0) {
        const licenseKeyDoc = await LicenseKey.findOne({ productId }).session(session).select("keys");
        const allRefunded = licenseKeyDoc && allKeyIds.every((kid) => { const k = licenseKeyDoc.keys.id(kid); return k && (k.isRefunded || k.isUsed); });
        if (allRefunded) {
          order.items[itemIndex].refunded = true;
          order.items[itemIndex].refundedAt = new Date();
        }
      } else {
        order.items[itemIndex].refunded = true;
        order.items[itemIndex].refundedAt = new Date();
      }
    }
    const allItemsRefunded = order.items.every((item) => item.refunded);
    if (allItemsRefunded) {
      order.paymentStatus = "refunded";
      order.orderStatus = "returned";
    } else {
      order.orderStatus = "partially_completed";
    }
    await order.save({ session });

    refund.status = "COMPLETED";
    refund.refundedAt = new Date();
    if (manualRefundReference) refund.manualRefundReference = manualRefundReference;
    pushRefundHistory(refund, "admin", "MANUAL_REFUND_COMPLETED", refund.status, "COMPLETED", manualRefundReference ? `Admin marked refund sent via PayPal (manual). Reference: ${manualRefundReference}` : "Admin marked refund sent via PayPal (manual)");
    await refund.save({ session });

    await session.commitTransaction();
    session.endSession();

    await auditLog(adminUserId, "REFUND_MANUAL_COMPLETED", `Manual refund ${refund._id} completed`, {
      actor: "admin",
      action: "MANUAL_REFUND_COMPLETED",
      refundId: refund._id,
      refundStatus: "COMPLETED",
      payoutStatus: payoutHeld ? "HELD" : "RELEASED",
      orderId,
      productId,
      sellerId,
      refundAmount,
      timestamp: new Date(),
      notes: "Refund sent manually via PayPal; seller balance adjusted; keys invalidated.",
    });
    return {};
  } catch (err) {
    if (session.inTransaction()) await session.abortTransaction();
    session.endSession();
    throw err;
  }
};

// Purpose: List refund requests for the authenticated seller (first-level review)
const getSellerRefunds = asyncHandler(async (req, res) => {
  const seller = await Seller.findOne({ userId: req.user._id }).select("_id");
  if (!seller) {
    throw new ApiError(403, "Seller profile not found");
  }
  const { page = 1, limit = 10, status } = req.query;
  const match = { sellerId: seller._id };
  if (status) match.status = status;

  const refunds = await ReturnRefund.find(match)
    .populate("userId", "name email")
    .populate("orderId", "totalAmount createdAt orderStatus orderNumber")
    .populate("productId", "name images price productType")
    .sort({ createdAt: -1 })
    .skip((page - 1) * limit)
    .limit(parseInt(limit));

  const total = await ReturnRefund.countDocuments(match);

  return res.status(200).json(
    new ApiResponse(200, {
      refunds,
      pagination: { page: parseInt(page), limit: parseInt(limit), total, pages: Math.ceil(total / limit) },
    }, "Seller refund requests retrieved successfully")
  );
});

// Purpose: Seller cannot approve refunds; only admin can. Seller can submit optional feedback via sellerSubmitFeedback.
const sellerApproveRefund = asyncHandler(async (req, res) => {
  throw new ApiError(403, "Only admin can approve refunds. You may leave optional feedback for admin review.");
});

// Purpose: Seller cannot reject refunds; only admin can. Seller can submit optional feedback via sellerSubmitFeedback.
const sellerRejectRefund = asyncHandler(async (req, res) => {
  throw new ApiError(403, "Only admin can reject refunds. You may leave optional feedback for admin review.");
});

// Purpose: Seller submits optional feedback (advisory only; does not change refund status or block admin)
const sellerSubmitFeedback = asyncHandler(async (req, res) => {
  const seller = await Seller.findOne({ userId: req.user._id }).select("_id");
  if (!seller) throw new ApiError(403, "Seller profile not found");

  const { refundId } = req.params;
  const { feedback } = req.body;
  if (!mongoose.Types.ObjectId.isValid(refundId)) {
    throw new ApiError(400, "Invalid refund ID");
  }
  if (!feedback || typeof feedback !== "string" || !feedback.trim()) {
    throw new ApiError(400, "Feedback text is required");
  }

  const refund = await ReturnRefund.findById(refundId);
  if (!refund) throw new ApiError(404, "Refund request not found");
  if (refund.sellerId.toString() !== seller._id.toString()) {
    throw new ApiError(403, "You can only submit feedback for refunds on your products");
  }
  if (["COMPLETED", "ADMIN_REJECTED", "completed", "rejected"].includes(refund.status)) {
    throw new ApiError(400, "Cannot submit feedback after refund has been completed or rejected");
  }

  refund.sellerFeedback = feedback.trim();
  refund.sellerFeedbackAt = new Date();
  pushRefundHistory(refund, "seller", "SELLER_FEEDBACK", refund.status, refund.status, "Seller submitted advisory feedback (no status change)");
  await refund.save();

  await auditLog(req.user._id, "REFUND_SELLER_FEEDBACK", `Seller submitted feedback for refund ${refundId}`, { refundId, timestamp: new Date() });

  const updated = await ReturnRefund.findById(refundId)
    .populate("userId", "name email")
    .populate("orderId", "totalAmount createdAt orderStatus")
    .populate("productId", "name images price productType")
    .populate("sellerId", "shopName");
  return res.status(200).json(
    new ApiResponse(200, { refund: updated }, "Feedback submitted. Admin has full authority over this refund.")
  );
});

// Purpose: Customer escalates seller-rejected refund to admin
const escalateToAdmin = asyncHandler(async (req, res) => {
  const { refundId } = req.params;
  const userId = req.user._id;
  if (!mongoose.Types.ObjectId.isValid(refundId)) {
    throw new ApiError(400, "Invalid refund ID");
  }

  const refund = await ReturnRefund.findById(refundId);
  if (!refund) throw new ApiError(404, "Refund request not found");
  if (refund.userId.toString() !== userId.toString()) {
    throw new ApiError(403, "You can only escalate your own refund requests");
  }
  if (refund.status !== "SELLER_REJECTED") {
    throw new ApiError(400, "Only seller-rejected refunds can be escalated to admin");
  }

  const order = await Order.findById(refund.orderId).select("orderCompletedAt updatedAt createdAt").lean();
  if (!order || !isWithinRefundWindow(order)) {
    const message = "Refund period expired. Refunds are allowed only within 10 days of order completion.";
    throw new ApiError(400, message);
  }

  const previousStatus = refund.status;
  refund.status = "ADMIN_REVIEW";
  refund.currentStage = "ADMIN_REVIEW";
  pushRefundHistory(refund, "customer", "ESCALATE_TO_ADMIN", previousStatus, "ADMIN_REVIEW", "Customer escalated after seller rejection");
  await refund.save();

  await auditLog(userId, "REFUND_ESCALATED", `Refund ${refundId} escalated to admin`, { refundId });

  return res.status(200).json(
    new ApiResponse(200, refund, "Refund escalated to admin for final decision.")
  );
});

// Purpose: Retrieves customer's completed orders for refund dropdown
const getCompletedOrdersForRefund = asyncHandler(async (req, res) => {
  const userId = req.user._id;

  const orders = await Order.find({
    userId,
    paymentStatus: "paid",
    orderStatus: "completed",
  })
    .select("_id createdAt totalAmount items orderCompletedAt updatedAt")
    .populate("items.productId", "name images productType")
    .sort({ createdAt: -1 })
    .limit(100);

  const eligibleOrders = orders.filter(order => {
    if (!order.items.some(item => !item.refunded)) return false;
    return isWithinRefundWindow(order);
  });

  const formattedOrders = eligibleOrders.map(order => ({
    _id: order._id.toString(),
    orderId: order._id.toString(),
    orderDate: order.createdAt,
    orderTotalAmount: order.totalAmount,
    items: order.items
      .filter(item => !item.refunded)
      .map(item => {
        let productIdStr = '';
        if (item.productId) {
          if (item.productId._id) {
            productIdStr = String(item.productId._id);
          } else if (typeof item.productId === 'object' && item.productId.toString) {
            productIdStr = String(item.productId);
          } else {
            productIdStr = String(item.productId);
          }
        }
        
        return {
          productId: productIdStr,
          productName: item.productId?.name || 'Product',
          productImage: item.productId?.images?.[0] || null,
          productType: item.productId?.productType || 'LICENSE_KEY',
          unitPrice: item.unitPrice,
          qty: item.qty,
          lineTotal: item.lineTotal,
          assignedKeyIds: (item.assignedKeyIds || []).map(id => id?.toString?.() || id),
        };
      }),
  }));

  return res.status(200).json(
    new ApiResponse(200, { orders: formattedOrders }, "Completed orders retrieved successfully")
  );
});

// Purpose: Returns license keys for an order item so customer can select which key(s) to refund
const getOrderItemLicenseKeysForRefund = asyncHandler(async (req, res) => {
  const userId = req.user._id;
  const { orderId, productId } = req.query;

  if (!orderId || !productId) {
    throw new ApiError(400, "orderId and productId are required");
  }
  if (!mongoose.Types.ObjectId.isValid(orderId) || !mongoose.Types.ObjectId.isValid(productId)) {
    throw new ApiError(400, "Invalid orderId or productId");
  }

  const order = await Order.findOne({
    _id: orderId,
    userId,
    paymentStatus: "paid",
    orderStatus: "completed",
  })
    .select("items orderCompletedAt updatedAt createdAt")
    .populate("items.productId", "productType");

  if (!order) {
    throw new ApiError(404, "Order not found or not eligible for refund");
  }
  if (!isWithinRefundWindow(order)) {
    throw new ApiError(400, "Refund period expired. Refunds are allowed only within 10 days of order completion.");
  }

  const productIdStr = productId.toString().trim();
  const normalizePid = (p) => {
    if (!p) return null;
    if (p._id) return p._id.toString().trim();
    return String(p).trim();
  };
  const orderItem = order.items.find(
    (item) => normalizePid(item.productId) === productIdStr
  );
  if (!orderItem) {
    throw new ApiError(404, "Product not found in this order");
  }
  if (orderItem.refunded) {
    throw new ApiError(400, "This product has already been fully refunded");
  }

  const keyIds = orderItem.assignedKeyIds || [];
  if (keyIds.length === 0) {
    return res.status(200).json(
      new ApiResponse(200, { keys: [], productType: orderItem.productId?.productType || "LICENSE_KEY" }, "No keys to refund")
    );
  }

  const licenseKeyDoc = await LicenseKey.findOne({
    productId: new mongoose.Types.ObjectId(productId),
  }).select("keys");
  if (!licenseKeyDoc) {
    return res.status(200).json(
      new ApiResponse(200, { keys: [], productType: orderItem.productId?.productType || "LICENSE_KEY" }, "No keys found")
    );
  }

  const orderCompletedAt = order.orderCompletedAt || order.createdAt;
  const product = await Product.findById(productId).select("productType").lean();
  const deliveryType = product?.productType === "ACCOUNT_BASED" ? "account" : "license";
  const unitPrice = orderItem.unitPrice ?? 0;

  const keys = [];
  for (let i = 0; i < keyIds.length; i++) {
    const keyId = keyIds[i];
    const key = licenseKeyDoc.keys.id(keyId);
    if (!key) continue;
    const status = key.isRefunded ? "refunded" : "active";
    const suffix = key._id.toString().slice(-4);
    const issuedAt = key.assignedAt || orderCompletedAt;
    keys.push({
      licenseKeyId: key._id.toString(),
      keyId: key._id.toString(),
      keyValue: `XXXX-${suffix}`,
      price: unitPrice,
      deliveryType,
      productType: orderItem.productId?.productType || "LICENSE_KEY",
      status,
      issuedAt: issuedAt ? new Date(issuedAt).toISOString() : null,
    });
  }

  return res.status(200).json(
    new ApiResponse(200, {
      keys: keys.filter((k) => k.status !== "refunded"),
      productType: orderItem.productId?.productType || "LICENSE_KEY",
    }, "License keys for refund selection retrieved successfully")
  );
});

// Purpose: Upload evidence images for refund; returns URLs to send in createRefundRequest body
const uploadRefundEvidence = asyncHandler(async (req, res) => {
  const files = req.files || [];
  if (files.length === 0) {
    throw new ApiError(400, "At least one evidence image is required");
  }
  const { fileUploader } = await import("../utils/cloudinary.js");
  const urls = [];
  for (const file of files) {
    if (file.path) {
      try {
        const result = await fileUploader(file.path);
        urls.push(result.url || result.secure_url);
      } catch (e) {
        logger.warn("Refund evidence upload failed for one file", { path: file.path, error: e.message });
      }
    }
  }
  if (urls.length === 0) throw new ApiError(400, "No images could be uploaded. Please try again.");
  return res.status(200).json(
    new ApiResponse(200, { urls }, "Evidence uploaded successfully. Use these URLs in evidenceFiles when creating the refund request.")
  );
});

// Purpose: Add a message to refund-specific chat (customer, admin; seller only when admin requested input)
const addRefundMessage = asyncHandler(async (req, res) => {
  const { refundId } = req.params;
  const { message } = req.body;
  const userId = req.user._id;
  if (!mongoose.Types.ObjectId.isValid(refundId)) throw new ApiError(400, "Invalid refund ID");
  if (!message || typeof message !== "string" || !message.trim()) {
    throw new ApiError(400, "Message is required");
  }
  const refund = await ReturnRefund.findById(refundId);
  if (!refund) throw new ApiError(404, "Refund request not found");

  const isAdmin = req.user.roles?.includes("admin");
  const isCustomer = refund.userId && refund.userId.toString() === userId.toString();
  const seller = await Seller.findOne({ userId }).select("_id");
  const isSeller = seller && refund.sellerId && refund.sellerId.toString() === seller._id.toString();

  let senderRole = null;
  if (isAdmin) senderRole = "admin";
  else if (isCustomer) senderRole = "customer";
  else if (isSeller) senderRole = "seller";

  if (!senderRole) throw new ApiError(403, "You do not have access to this refund chat");
  if (senderRole === "seller" && !refund.adminRequestedSellerInput) {
    throw new ApiError(403, "Forbidden. Seller is read-only in refund chat until admin requests your input.");
  }

  if (!refund.refundMessages) refund.refundMessages = [];
  refund.refundMessages.push({
    senderId: userId,
    senderRole,
    message: message.trim(),
    createdAt: new Date(),
  });
  if (senderRole === "seller") refund.sellerRepliedAt = new Date();
  await refund.save();

  const added = refund.refundMessages[refund.refundMessages.length - 1];
  await auditLog(userId, "REFUND_MESSAGE_ADDED", `Message added to refund ${refundId}`, {
    actor: senderRole,
    refundId,
    timestamp: new Date(),
  });
  return res.status(201).json(new ApiResponse(201, { message: added }, "Message added"));
});

// Purpose: Get refund chat messages (customer, seller, admin with access)
const getRefundMessages = asyncHandler(async (req, res) => {
  const { refundId } = req.params;
  if (!mongoose.Types.ObjectId.isValid(refundId)) throw new ApiError(400, "Invalid refund ID");
  const refund = await ReturnRefund.findById(refundId).select("refundMessages userId sellerId").populate("refundMessages.senderId", "name email");
  if (!refund) throw new ApiError(404, "Refund request not found");

  const userId = req.user._id;
  const isAdmin = req.user.roles?.includes("admin");
  const isCustomer = refund.userId && refund.userId.toString() === userId.toString();
  const seller = await Seller.findOne({ userId }).select("_id");
  const isSeller = seller && refund.sellerId && refund.sellerId.toString() === seller._id.toString();
  if (!isAdmin && !isCustomer && !isSeller) throw new ApiError(403, "You do not have access to this refund");

  const messages = (refund.refundMessages || []).map((m) => ({
    _id: m._id,
    senderId: m.senderId,
    senderRole: m.senderRole,
    senderName: m.senderId?.name,
    message: m.message,
    createdAt: m.createdAt,
  }));
  return res.status(200).json(new ApiResponse(200, { messages }, "Refund messages retrieved"));
});

// Purpose: Admin requests seller clarification (optional verification)
const requestSellerInput = asyncHandler(async (req, res) => {
  if (!req.user.roles?.includes("admin")) throw new ApiError(403, "Only admins can request seller input");
  const { refundId } = req.params;
  const { note } = req.body;
  if (!mongoose.Types.ObjectId.isValid(refundId)) throw new ApiError(400, "Invalid refund ID");
  const refund = await ReturnRefund.findById(refundId);
  if (!refund) throw new ApiError(404, "Refund request not found");
  refund.adminRequestedSellerInput = true;
  refund.adminRequestedSellerInputAt = new Date();
  if (!refund.refundMessages) refund.refundMessages = [];
  refund.refundMessages.push({
    senderId: req.user._id,
    senderRole: "admin",
    message: note?.trim() ? `Admin requested seller input: ${note.trim()}` : "Admin requested seller clarification. Please reply within 48 hours.",
    createdAt: new Date(),
  });
  await refund.save();
  await auditLog(req.user._id, "REFUND_SELLER_INPUT_REQUESTED", `Admin requested seller input for refund ${refundId}`, {
    actor: "admin",
    refundId,
    timestamp: new Date(),
  });
  return res.status(200).json(new ApiResponse(200, refund, "Seller has been notified. They can reply in the refund chat."));
});

// Purpose: Admin marks manual PayPal refund as completed (after sending refund via PayPal dashboard). Prevents double completion.
const markManualRefund = asyncHandler(async (req, res) => {
  if (!req.user.roles?.includes("admin")) {
    throw new ApiError(403, "Only admins can mark manual refund as completed");
  }
  const { refundId } = req.params;
  const { manualRefundReference } = req.body || {};
  if (!mongoose.Types.ObjectId.isValid(refundId)) {
    throw new ApiError(400, "Invalid refund ID");
  }
  const refund = await ReturnRefund.findById(refundId).populate("orderId").populate("productId", "productType name");
  if (!refund) throw new ApiError(404, "Refund request not found");
  if (refund.status === "COMPLETED" || refund.status === "completed") {
    throw new ApiError(400, "Refund already completed. Cannot mark as refunded again.");
  }
  if (refund.refundMethod !== "ORIGINAL_PAYMENT") {
    throw new ApiError(400, "Only refunds with method ORIGINAL_PAYMENT can be marked as manual refund. Use Approve for wallet refunds.");
  }
  const allowed = ["ADMIN_REVIEW", "WAITING_FOR_MANUAL_REFUND"];
  if (!allowed.includes(refund.status)) {
    throw new ApiError(400, `Refund must be in ADMIN_REVIEW or WAITING_FOR_MANUAL_REFUND. Current status: ${refund.status}`);
  }
  const orderForWindow = await Order.findById(refund.orderId).select("orderCompletedAt updatedAt createdAt").lean();
  if (!orderForWindow || !isWithinRefundWindow(orderForWindow)) {
    throw new ApiError(400, "Refund period expired.");
  }
  const result = await processManualRefundCompletion(refund, req.user._id, typeof manualRefundReference === "string" ? manualRefundReference.trim() || null : null);
  if (result.hold) {
    refund.status = "ON_HOLD_INSUFFICIENT_FUNDS";
    await refund.save();
    return res.status(400).json(
      new ApiResponse(400, { refund, hold: true }, "Cannot complete: insufficient seller balance. Refund is on hold.")
    );
  }
  const updated = await ReturnRefund.findById(refundId)
    .populate("userId", "name email")
    .populate("orderId", "totalAmount createdAt orderStatus")
    .populate("productId", "name images price productType")
    .populate("sellerId", "shopName");
  return res.status(200).json(
    new ApiResponse(200, { refund: updated }, "Manual refund marked as completed. Seller balance adjusted; keys invalidated.")
  );
});

export {
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
};
