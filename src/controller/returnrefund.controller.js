import mongoose from "mongoose";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { logger } from "../utils/logger.js";
import { ReturnRefund } from "../models/returnrefund.model.js";
import { Order } from "../models/order.model.js";
import { LicenseKey } from "../models/licensekey.model.js";
import { Payout } from "../models/payout.model.js";
import { auditLog } from "../services/audit.service.js";
import { REFUND_STATUS } from "../constants.js";
import { processRefund } from "../services/payment.service.js";

// Creates a return/refund request for a product in an order
const createReturnRefund = asyncHandler(async (req, res) => {
  const { orderId, productId, reason } = req.body;
  const userId = req.user._id;

  if (!orderId || !productId || !reason) {
    throw new ApiError(400, "Order ID, product ID, and reason are required");
  }

  if (!mongoose.Types.ObjectId.isValid(orderId) || !mongoose.Types.ObjectId.isValid(productId)) {
    throw new ApiError(400, "Invalid order ID or product ID");
  }

  const order = await Order.findOne({
    _id: orderId,
    userId,
    paymentStatus: "paid",
  });

  if (!order) {
    throw new ApiError(404, "Order not found or not eligible for refund");
  }

  const orderItem = order.items.find(item => item.productId.toString() === productId);
  if (!orderItem) {
    throw new ApiError(404, "Product not found in this order");
  }

  const existingRefund = await ReturnRefund.findOne({ orderId, productId, userId });
  if (existingRefund) {
    throw new ApiError(400, "A refund request already exists for this product in this order");
  }

  const daysSinceOrder = (new Date() - order.createdAt) / (1000 * 60 * 60 * 24);
  if (daysSinceOrder > 30) {
    throw new ApiError(400, "Refund requests must be made within 30 days of purchase");
  }

  const returnRefund = await ReturnRefund.create({
    orderId,
    productId,
    userId,
    reason,
    status: "pending",
  });

  await auditLog(userId, "REFUND_REQUESTED", `Refund requested for order ${orderId}, product ${productId}`, {
    returnRefundId: returnRefund._id,
    orderId,
    productId,
  });

  return res.status(201).json(
    new ApiResponse(201, returnRefund, "Refund request created successfully")
  );
});

// Retrieves user's refund requests with pagination and optional status filtering
const getUserRefunds = asyncHandler(async (req, res) => {
  const userId = req.user._id;
  const { page = 1, limit = 20, status } = req.query;

  const match = { userId };
  if (status) {
    match.status = status;
  }

  const refunds = await ReturnRefund.find(match)
    .populate("orderId", "totalAmount createdAt orderStatus")
    .populate("productId", "name images price")
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

// Retrieves a refund request by ID with access verification
const getRefundById = asyncHandler(async (req, res) => {
  const { refundId } = req.params;
  const userId = req.user._id;

  if (!mongoose.Types.ObjectId.isValid(refundId)) {
    throw new ApiError(400, "Invalid refund ID");
  }

  const refund = await ReturnRefund.findById(refundId)
    .populate("orderId", "totalAmount createdAt orderStatus items")
    .populate("productId", "name images price");

  if (!refund) {
    throw new ApiError(404, "Refund request not found");
  }

  const isOwner = refund.userId.toString() === userId.toString();
  const isAdmin = req.user.roles?.includes("admin");

  if (!isOwner && !isAdmin) {
    throw new ApiError(403, "You don't have access to this refund request");
  }

  return res.status(200).json(
    new ApiResponse(200, refund, "Refund request retrieved successfully")
  );
});

// Retrieves all refund requests with pagination and optional status filtering for admin
const getAllRefunds = asyncHandler(async (req, res) => {
  if (!req.user.roles?.includes("admin")) {
    throw new ApiError(403, "Only admins can view all refund requests");
  }

  const { page = 1, limit = 20, status } = req.query;

  const match = {};
  if (status) {
    match.status = status;
  }

  const refunds = await ReturnRefund.find(match)
    .populate("userId", "name email")
    .populate("orderId", "totalAmount createdAt orderStatus")
    .populate("productId", "name images price")
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

// Updates refund status and processes refund if approved (admin only)
const updateRefundStatus = asyncHandler(async (req, res) => {
  if (!req.user.roles?.includes("admin")) {
    throw new ApiError(403, "Only admins can update refund status");
  }

  const { refundId } = req.params;
  const { status, adminNotes } = req.body;

  if (!mongoose.Types.ObjectId.isValid(refundId)) {
    throw new ApiError(400, "Invalid refund ID");
  }

  if (!status || !REFUND_STATUS.includes(status)) {
    throw new ApiError(400, "Valid status is required");
  }

  const refund = await ReturnRefund.findById(refundId);
  if (!refund) {
    throw new ApiError(404, "Refund request not found");
  }

  if (status === "approved") {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const order = await Order.findById(refund.orderId).session(session);
      if (!order) {
        throw new ApiError(404, "Order not found");
      }

      if (order.paymentStatus !== "paid") {
        throw new ApiError(400, "Order is not paid, cannot refund");
      }

      const orderItem = order.items.find(
        item => item.productId.toString() === refund.productId.toString()
      );

      if (!orderItem) {
        throw new ApiError(404, "Product not found in this order");
      }

      const refundAmount = orderItem.lineTotal;
      refund.refundAmount = refundAmount;

      if (order.paypalCaptureId) {
        try {
          const refundResult = await processRefund(
            order.paypalCaptureId,
            refundAmount,
            order.currency
          );

          refund.refundTransactionId = refundResult.id;
        } catch (paypalError) {
          logger.error("PayPal refund failed", paypalError);
          throw new ApiError(500, `PayPal refund failed: ${paypalError.message}`);
        }
      } else {
        throw new ApiError(400, "No PayPal capture ID found for this order");
      }

      if (orderItem.assignedKeyIds && orderItem.assignedKeyIds.length > 0) {
        await LicenseKey.updateOne(
          { productId: orderItem.productId },
          {
            $set: {
              'keys.$[key].isUsed': false,
              'keys.$[key].assignedTo': null,
              'keys.$[key].assignedToOrder': null,
              'keys.$[key].assignedAt': null,
            },
          },
          {
            arrayFilters: [{ 'key._id': { $in: orderItem.assignedKeyIds } }],
            session,
          }
        );
      }

      const payouts = await Payout.find({
        orderId: order._id,
        sellerId: orderItem.sellerId,
        requestType: 'scheduled',
        status: { $in: ['pending', 'hold'] },
      }).session(session);

      for (const payout of payouts) {
        payout.status = 'blocked';
        payout.notes = `Cancelled due to refund for order ${order._id}`;
        await payout.save({ session });
      }

      const allItemsRefunded = order.items.every(item => {
        if (item.productId.toString() === refund.productId.toString()) {
          return true;
        }
        return false;
      });

      if (allItemsRefunded) {
        order.paymentStatus = "refunded";
      } else {
        orderItem.refunded = true;
        orderItem.refundedAt = new Date();
      }

      await order.save({ session });

      refund.status = "refunded";
      refund.refundedAt = new Date();
      refund.adminNotes = adminNotes || "Refund processed successfully";
      await refund.save({ session });

      await session.commitTransaction();
      
      await refund.populate("userId");
      await refund.populate("orderId", "totalAmount createdAt orderStatus");
      await refund.populate("productId", "name images price");
      await auditLog(
        req.user._id,
        "REFUND_PROCESSED",
        `Refund processed for order ${order._id}, product ${refund.productId}`,
        {
          refundId: refund._id,
          orderId: order._id,
          productId: refund.productId,
          refundAmount,
        }
      );

      return res.status(200).json(
        new ApiResponse(200, refund, "Refund processed successfully")
      );
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }
  } else {
    // For other status updates (rejected, etc.)
    const updatedRefund = await ReturnRefund.findByIdAndUpdate(
      refundId,
      { status, adminNotes },
      { new: true }
    )
      .populate("userId")
      .populate("orderId", "totalAmount createdAt orderStatus")
      .populate("productId", "name images price");

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

// Cancels a pending refund request (user only)
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

  if (refund.status !== "pending") {
    throw new ApiError(400, "Only pending refund requests can be cancelled");
  }

  await ReturnRefund.findByIdAndDelete(refundId);

  await auditLog(userId, "REFUND_CANCELLED", `Refund ${refundId} cancelled by user`, {
    refundId,
  });

  return res.status(200).json(
    new ApiResponse(200, null, "Refund request cancelled successfully")
  );
});

export {
  createReturnRefund,
  getUserRefunds,
  getRefundById,
  getAllRefunds,
  updateRefundStatus,
  cancelRefund,
};

