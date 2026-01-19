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
import { REFUND_STATUS } from "../constants.js";
import { creditWallet } from "../services/wallet.service.js";
import { getSellerBalance } from "../services/payout.service.js";

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

  // Validate order belongs to user and is completed
  const order = await Order.findOne({
    _id: orderId,
    userId,
    paymentStatus: "paid",
    orderStatus: "completed", // Only completed orders can be refunded
  }).populate("items.productId", "productType sellerId");

  if (!order) {
    throw new ApiError(404, "Order not found or not eligible for refund. Only completed orders can be refunded.");
  }

  // Find the order item - handle both populated and non-populated productId
  const productIdStr = productId.toString().trim();
  
  // Normalize productId for comparison
  const normalizeProductId = (pid) => {
    if (!pid) return null;
    if (pid._id) return pid._id.toString().trim();
    if (typeof pid === 'object' && pid.toString) return pid.toString().trim();
    return String(pid).trim();
  };
  
  const orderItem = order.items.find(item => {
    const itemProductId = normalizeProductId(item.productId);
    return itemProductId === productIdStr;
  });
  
  if (!orderItem) {
    // Log for debugging
    const availableProducts = order.items.map(item => ({
      productId: normalizeProductId(item.productId),
      productName: item.productId?.name || 'N/A',
      refunded: item.refunded || false
    }));
    
    logger.warn("Product not found in order", {
      orderId: order._id.toString(),
      requestedProductId: productIdStr,
      availableProducts: availableProducts
    });
    
    throw new ApiError(404, `Product not found in this order. Available products: ${availableProducts.map(p => p.productName).join(', ')}`);
  }

  // Check if product is already refunded
  if (orderItem.refunded) {
    throw new ApiError(400, "This product has already been refunded");
  }

  // Check for existing pending/approved refund request
  const existingRefund = await ReturnRefund.findOne({
    orderId,
    productId,
    userId,
    status: { $in: ['pending', 'approved'] },
  });

  if (existingRefund) {
    throw new ApiError(400, "A refund request already exists for this product in this order");
  }

  // Get seller ID from order item (sellerId is directly in order items)
  const sellerId = orderItem.sellerId?._id 
    ? orderItem.sellerId._id.toString() 
    : orderItem.sellerId?.toString() 
    ? orderItem.sellerId.toString() 
    : orderItem.sellerId;
  
  if (!sellerId) {
    throw new ApiError(400, "Seller ID not found in order item");
  }

  const returnRefund = await ReturnRefund.create({
    orderId,
    productId,
    userId,
    sellerId: sellerId,
    reason,
    status: "pending",
  });

  await auditLog(userId, "REFUND_REQUESTED", `Refund requested for order ${orderId}, product ${productId}`, {
    returnRefundId: returnRefund._id,
    orderId,
    productId,
    sellerId: sellerId,
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

// Retrieves a refund request by ID with access verification
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

// Updates refund status and processes refund if approved (admin only)
const updateRefundStatus = asyncHandler(async (req, res) => {
  if (!req.user.roles?.includes("admin")) {
    throw new ApiError(403, "Only admins can update refund status");
  }

  const { refundId } = req.params;
  const { status, adminNotes, rejectionReason } = req.body;

  if (!mongoose.Types.ObjectId.isValid(refundId)) {
    throw new ApiError(400, "Invalid refund ID");
  }

  if (!status || !REFUND_STATUS.includes(status)) {
    throw new ApiError(400, "Valid status is required");
  }

  // Rejection requires a reason
  if (status === "rejected" && !rejectionReason?.trim()) {
    throw new ApiError(400, "Rejection reason is required when rejecting a refund request");
  }

  const refund = await ReturnRefund.findById(refundId)
    .populate("orderId")
    .populate("productId", "productType");

  if (!refund) {
    throw new ApiError(404, "Refund request not found");
  }

  if (status === "approved") {
    // Process refund approval
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

      if (order.orderStatus !== "completed") {
        throw new ApiError(400, "Only completed orders can be refunded");
      }

      const orderItem = order.items.find(
        item => item.productId.toString() === refund.productId.toString()
      );

      if (!orderItem) {
        throw new ApiError(404, "Product not found in this order");
      }

      if (orderItem.refunded) {
        throw new ApiError(400, "This product has already been refunded");
      }

      const refundAmount = orderItem.lineTotal;
      refund.refundAmount = refundAmount;

      // Check seller balance before processing refund
      const seller = await Seller.findById(refund.sellerId).session(session);
      if (!seller) {
        throw new ApiError(404, "Seller not found");
      }

      const sellerBalance = await getSellerBalance(seller._id);
      const availableBalance = sellerBalance.available || 0;

      // Check if seller has sufficient balance
      // We need to account for the seller's earnings (netAmount after commission)
      // The refund amount is the lineTotal, but seller only received netAmount
      // So we need to check if seller has at least the netAmount they received
      const sellerEarning = orderItem.sellerEarning || 0;
      
      if (availableBalance < sellerEarning) {
        await session.abortTransaction();
        throw new ApiError(400, `Insufficient seller balance. Seller has $${availableBalance.toFixed(2)} available, but needs $${sellerEarning.toFixed(2)} for this refund.`);
      }

      // Deduct from seller balance by creating a refund deduction payout
      // This creates a negative payout entry that reduces available balance
      const refundDeduction = await Payout.create([{
        sellerId: seller._id,
        orderId: order._id,
        requestType: 'scheduled',
        grossAmount: -refundAmount, // Negative amount
        commissionAmount: 0,
        netAmount: -sellerEarning, // Negative seller earning
        currency: 'USD',
        status: 'blocked', // Blocked to prevent it from being processed
        notes: `Refund deduction for order ${order._id}, product ${refund.productId}`,
      }], { session });

      // Credit customer wallet
      await creditWallet(
        refund.userId,
        refundAmount,
        `Refund for order ${order._id}, product ${refund.productId?.name || 'Product'}`,
        {
          orderId: order._id,
          refundId: refund._id,
          productId: refund.productId,
        }
      );

      // Mark keys/accounts as refunded (permanently invalidate)
      if (orderItem.assignedKeyIds && orderItem.assignedKeyIds.length > 0) {
        const product = await Product.findById(refund.productId).session(session);
        const isAccountBased = product?.productType === 'ACCOUNT_BASED';

        await LicenseKey.updateOne(
          { productId: refund.productId },
          {
            $set: {
              'keys.$[key].isRefunded': true,
              'keys.$[key].refundedAt': new Date(),
              'keys.$[key].isUsed': true, // Also mark as used so it can't be reused
            },
          },
          {
            arrayFilters: [{ 'key._id': { $in: orderItem.assignedKeyIds } }],
            session,
          }
        );
      }

      // Block existing payouts for this order item
      const payouts = await Payout.find({
        orderId: order._id,
        sellerId: seller._id,
        requestType: 'scheduled',
        status: { $in: ['pending', 'hold'] },
      }).session(session);

      for (const payout of payouts) {
        payout.status = 'blocked';
        payout.notes = `Blocked due to refund for order ${order._id}`;
        await payout.save({ session });
      }

      // Update order item as refunded
      orderItem.refunded = true;
      orderItem.refundedAt = new Date();

      // Check if all items are refunded
      const allItemsRefunded = order.items.every(item => item.refunded);
      if (allItemsRefunded) {
        order.paymentStatus = "refunded";
      }

      await order.save({ session });

      // Update refund status to completed
      refund.status = "completed";
      refund.refundedAt = new Date();
      refund.adminNotes = adminNotes || "Refund processed successfully";
      await refund.save({ session });

      await session.commitTransaction();

      await refund.populate("userId", "name email");
      await refund.populate("orderId", "totalAmount createdAt orderStatus");
      await refund.populate("productId", "name images price productType");
      await refund.populate("sellerId", "shopName");

      await auditLog(
        req.user._id,
        "REFUND_COMPLETED",
        `Refund completed for order ${order._id}, product ${refund.productId}`,
        {
          refundId: refund._id,
          orderId: order._id,
          productId: refund.productId,
          sellerId: seller._id,
          refundAmount,
          sellerEarning,
        }
      );

      return res.status(200).json(
        new ApiResponse(200, refund, "Refund processed successfully")
      );
    } catch (error) {
      await session.abortTransaction();
      logger.error("Refund processing failed", error);
      throw error;
    } finally {
      session.endSession();
    }
  } else if (status === "rejected") {
    // Handle rejection
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
    // For other status updates
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

// Get customer's completed orders for refund dropdown
const getCompletedOrdersForRefund = asyncHandler(async (req, res) => {
  const userId = req.user._id;

  const orders = await Order.find({
    userId,
    paymentStatus: "paid",
    orderStatus: "completed",
  })
    .select("_id createdAt totalAmount items")
    .populate("items.productId", "name images productType")
    .sort({ createdAt: -1 })
    .limit(100); // Limit to recent 100 orders

  // Filter out orders where all items are already refunded
  const eligibleOrders = orders.filter(order => {
    return order.items.some(item => !item.refunded);
  });

  const formattedOrders = eligibleOrders.map(order => ({
    _id: order._id.toString(),
    orderId: order._id.toString(),
    orderDate: order.createdAt,
    orderTotalAmount: order.totalAmount,
    items: order.items
      .filter(item => !item.refunded) // Only show non-refunded items
      .map(item => {
        // Handle both populated and non-populated productId - always return as string
        let productIdStr = '';
        if (item.productId) {
          if (item.productId._id) {
            // Populated productId (object with _id)
            productIdStr = String(item.productId._id);
          } else if (typeof item.productId === 'object' && item.productId.toString) {
            // ObjectId
            productIdStr = String(item.productId);
          } else {
            // Already a string or other type
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
        };
      }),
  }));

  return res.status(200).json(
    new ApiResponse(200, { orders: formattedOrders }, "Completed orders retrieved successfully")
  );
});

export {
  createReturnRefund,
  getUserRefunds,
  getRefundById,
  getAllRefunds,
  updateRefundStatus,
  cancelRefund,
  getCompletedOrdersForRefund,
};
