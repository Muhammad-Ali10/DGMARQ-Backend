import mongoose from "mongoose";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { Dispute } from "../models/dispute.model.js";
import { Order } from "../models/order.model.js";
import { LicenseKey } from "../models/licensekey.model.js";
import { auditLog } from "../services/audit.service.js";

// Creates a dispute for an order
const createDispute = asyncHandler(async (req, res) => {
  const { orderId, type, reason, evidence } = req.body;
  const userId = req.user._id;

  if (!orderId || !type || !reason) {
    throw new ApiError(400, "Order ID, type, and reason are required");
  }

  if (!mongoose.Types.ObjectId.isValid(orderId)) {
    throw new ApiError(400, "Invalid order ID");
  }

  const order = await Order.findById(orderId).populate("items.productId");
  if (!order) {
    throw new ApiError(404, "Order not found");
  }

  if (order.userId.toString() !== userId.toString()) {
    throw new ApiError(403, "You can only create disputes for your own orders");
  }

  const existingDispute = await Dispute.findOne({ orderId, userId });
  if (existingDispute) {
    throw new ApiError(400, "A dispute already exists for this order");
  }

  const sellerId = order.items[0]?.sellerId;
  if (!sellerId) {
    throw new ApiError(400, "Invalid order structure");
  }

  const dispute = await Dispute.create({
    orderId,
    userId,
    sellerId,
    type,
    reason,
    evidence: evidence || [],
    status: "open",
  });

  await auditLog(userId, "DISPUTE_CREATED", `Dispute created for order ${orderId}`, {
    disputeId: dispute._id,
    orderId,
    type,
  });

  return res.status(201).json(
    new ApiResponse(201, dispute, "Dispute created successfully")
  );
});

// Retrieves user's disputes with pagination and optional status filtering
const getUserDisputes = asyncHandler(async (req, res) => {
  const userId = req.user._id;
  const { page = 1, limit = 20, status } = req.query;

  const match = { userId };
  if (status) {
    match.status = status;
  }

  const disputes = await Dispute.find(match)
    .populate("orderId", "totalAmount createdAt orderStatus")
    .populate("sellerId", "shopName")
    .sort({ createdAt: -1 })
    .skip((page - 1) * limit)
    .limit(parseInt(limit));

  const total = await Dispute.countDocuments(match);

  return res.status(200).json(
    new ApiResponse(200, {
      disputes,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit),
      },
    }, "Disputes retrieved successfully")
  );
});

// Retrieves a dispute by ID with access verification
const getDisputeById = asyncHandler(async (req, res) => {
  const { disputeId } = req.params;
  const userId = req.user._id;

  if (!mongoose.Types.ObjectId.isValid(disputeId)) {
    throw new ApiError(400, "Invalid dispute ID");
  }

  const dispute = await Dispute.findById(disputeId)
    .populate("orderId")
    .populate("sellerId", "shopName")
    .populate("userId", "name email")
    .populate("adminId", "name email");

  if (!dispute) {
    throw new ApiError(404, "Dispute not found");
  }

  const isOwner = dispute.userId.toString() === userId.toString();
  const isSeller = dispute.sellerId.toString() === userId.toString();
  const isAdmin = req.user.roles?.includes("admin");

  if (!isOwner && !isSeller && !isAdmin) {
    throw new ApiError(403, "You don't have access to this dispute");
  }

  return res.status(200).json(
    new ApiResponse(200, dispute, "Dispute retrieved successfully")
  );
});

// Retrieves seller's disputes with pagination and optional status filtering
const getSellerDisputes = asyncHandler(async (req, res) => {
  const sellerId = req.user.seller?._id || req.user._id;
  const { page = 1, limit = 20, status } = req.query;

  const match = { sellerId };
  if (status) {
    match.status = status;
  }

  const disputes = await Dispute.find(match)
    .populate("orderId", "totalAmount createdAt orderStatus")
    .populate("userId", "name email")
    .sort({ createdAt: -1 })
    .skip((page - 1) * limit)
    .limit(parseInt(limit));

  const total = await Dispute.countDocuments(match);

  return res.status(200).json(
    new ApiResponse(200, {
      disputes,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit),
      },
    }, "Disputes retrieved successfully")
  );
});

// Updates dispute status and resolution details (admin only)
const updateDispute = asyncHandler(async (req, res) => {
  const { disputeId } = req.params;
  const { status, adminNotes, resolution, refundAmount, refundStatus } = req.body;
  const adminId = req.user._id;

  if (!req.user.roles?.includes("admin")) {
    throw new ApiError(403, "Only admins can update disputes");
  }

  if (!mongoose.Types.ObjectId.isValid(disputeId)) {
    throw new ApiError(400, "Invalid dispute ID");
  }

  const dispute = await Dispute.findById(disputeId);
  if (!dispute) {
    throw new ApiError(404, "Dispute not found");
  }

  const updateData = {};
  if (status) updateData.status = status;
  if (adminNotes !== undefined) updateData.adminNotes = adminNotes;
  if (resolution !== undefined) updateData.resolution = resolution;
  if (refundAmount !== undefined) updateData.refundAmount = refundAmount;
  if (refundStatus !== undefined) updateData.refundStatus = refundStatus;

  if (status === "resolved") {
    updateData.resolvedAt = new Date();
  }

  updateData.adminId = adminId;

  const updatedDispute = await Dispute.findByIdAndUpdate(
    disputeId,
    updateData,
    { new: true }
  ).populate("orderId").populate("sellerId").populate("userId");

  await auditLog(adminId, "DISPUTE_UPDATED", `Dispute ${disputeId} updated by admin`, {
    disputeId,
    status,
    adminId,
  });

  return res.status(200).json(
    new ApiResponse(200, updatedDispute, "Dispute updated successfully")
  );
});

// Retrieves all disputes with pagination and optional filtering (admin only)
const getAllDisputes = asyncHandler(async (req, res) => {
  if (!req.user.roles?.includes("admin")) {
    throw new ApiError(403, "Only admins can view all disputes");
  }

  const { page = 1, limit = 20, status, type } = req.query;

  const match = {};
  if (status) match.status = status;
  if (type) match.type = type;

  const disputes = await Dispute.find(match)
    .populate("orderId", "totalAmount createdAt orderStatus")
    .populate("sellerId", "shopName")
    .populate("userId", "name email")
    .populate("adminId", "name email")
    .sort({ createdAt: -1 })
    .skip((page - 1) * limit)
    .limit(parseInt(limit));

  const total = await Dispute.countDocuments(match);

  return res.status(200).json(
    new ApiResponse(200, {
      disputes,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit),
      },
    }, "All disputes retrieved successfully")
  );
});

export {
  createDispute,
  getUserDisputes,
  getDisputeById,
  getSellerDisputes,
  updateDispute,
  getAllDisputes,
};

