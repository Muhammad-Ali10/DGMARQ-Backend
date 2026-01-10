import mongoose from "mongoose";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { Coupon } from "../models/coupon.model.js";
import { Order } from "../models/order.model.js";
import { auditLog } from "../services/audit.service.js";
import { COUPON_TYPE } from "../constants.js";

// Creates a new coupon with validation and duplicate checking (admin only)
const createCoupon = asyncHandler(async (req, res) => {
  if (!req.user.roles?.includes("admin")) {
    throw new ApiError(403, "Only admins can create coupons");
  }

  const {
    code,
    discountType,
    discountValue,
    minOrderAmount,
    usageLimit,
    perUserLimit,
    scope,
    productIds,
    sellerIds,
    isExclusive,
    startDate,
    endDate,
    isActive,
  } = req.body;

  if (!code || !discountType || !discountValue) {
    throw new ApiError(400, "Code, discount type, and discount value are required");
  }

  if (!COUPON_TYPE.includes(discountType)) {
    throw new ApiError(400, "Invalid discount type");
  }

  if (discountValue <= 0) {
    throw new ApiError(400, "Discount value must be greater than 0");
  }

  if (discountType === "percentage" && discountValue > 100) {
    throw new ApiError(400, "Percentage discount cannot exceed 100%");
  }

  const existingCoupon = await Coupon.findOne({ code: code.toUpperCase() });
  if (existingCoupon) {
    throw new ApiError(400, "Coupon code already exists");
  }

  const coupon = await Coupon.create({
    code: code.toUpperCase().trim(),
    discountType,
    discountValue,
    minOrderAmount: minOrderAmount || 0,
    usageLimit: usageLimit || 0,
    perUserLimit: perUserLimit || 0,
    scope: scope || 'global',
    productIds: productIds || [],
    sellerIds: sellerIds || [],
    isExclusive: isExclusive || false,
    startDate: startDate ? new Date(startDate) : new Date(),
    endDate: endDate ? new Date(endDate) : null,
    isActive: isActive !== undefined ? isActive : true,
    createdBy: req.user._id,
  });

  await auditLog(req.user._id, "COUPON_CREATED", `Coupon ${code} created`, {
    couponId: coupon._id,
    code: coupon.code,
  });

  return res.status(201).json(
    new ApiResponse(201, coupon, "Coupon created successfully")
  );
});

// Retrieves all coupons with optional filtering and pagination (admin only)
const getAllCoupons = asyncHandler(async (req, res) => {
  if (!req.user.roles?.includes("admin")) {
    throw new ApiError(403, "Only admins can view all coupons");
  }

  const { page = 1, limit = 20, isActive } = req.query;

  const match = {};
  if (isActive !== undefined) {
    match.isActive = isActive === "true";
  }

  const coupons = await Coupon.find(match)
    .populate("createdBy", "name email")
    .sort({ createdAt: -1 })
    .skip((page - 1) * limit)
    .limit(parseInt(limit));

  const total = await Coupon.countDocuments(match);

  return res.status(200).json(
    new ApiResponse(200, {
      coupons,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit),
      },
    }, "Coupons retrieved successfully")
  );
});

// Retrieves all active and valid coupons for public display
const getActiveCoupons = asyncHandler(async (req, res) => {
  const now = new Date();

  const coupons = await Coupon.find({
    isActive: true,
    startDate: { $lte: now },
    $or: [
      { endDate: null },
      { endDate: { $gte: now } },
    ],
    $or: [
      { usageLimit: 0 },
      { $expr: { $lt: ["$usedCount", "$usageLimit"] } },
    ],
  })
    .select("code discountType discountValue minOrderAmount")
    .sort({ createdAt: -1 });

  return res.status(200).json(
    new ApiResponse(200, coupons, "Active coupons retrieved successfully")
  );
});

// Validates a coupon code and calculates discount amount
const validateCoupon = asyncHandler(async (req, res) => {
  // Accept both 'code' and 'couponCode' for backward compatibility
  const code = req.body.code || req.body.couponCode;
  const { orderAmount } = req.body;

  if (!code || !code.trim()) {
    throw new ApiError(400, "Coupon code is required");
  }

  const coupon = await Coupon.findOne({ code: code.toUpperCase().trim() });
  if (!coupon) {
    throw new ApiError(404, "Invalid coupon code");
  }

  if (!coupon.isActive) {
    throw new ApiError(400, "Coupon is not active");
  }

  const now = new Date();
  if (coupon.startDate && coupon.startDate > now) {
    throw new ApiError(400, "Coupon is not yet valid");
  }

  if (coupon.endDate && coupon.endDate < now) {
    throw new ApiError(400, "Coupon has expired");
  }

  if (coupon.usageLimit > 0 && coupon.usedCount >= coupon.usageLimit) {
    throw new ApiError(400, "Coupon usage limit reached");
  }

  if (orderAmount && coupon.minOrderAmount > 0 && orderAmount < coupon.minOrderAmount) {
    throw new ApiError(400, `Minimum order amount of ${coupon.minOrderAmount} required`);
  }

  let discountAmount = 0;
  if (orderAmount) {
    if (coupon.discountType === "percentage") {
      discountAmount = (orderAmount * coupon.discountValue) / 100;
    } else {
      discountAmount = Math.min(coupon.discountValue, orderAmount);
    }
  }

  return res.status(200).json(
    new ApiResponse(200, {
      coupon: {
        code: coupon.code,
        discountType: coupon.discountType,
        discountValue: coupon.discountValue,
        discountAmount,
      },
      valid: true,
    }, "Coupon is valid")
  );
});

// Retrieves a single coupon by ID with creator details (admin only)
const getCouponById = asyncHandler(async (req, res) => {
  if (!req.user.roles?.includes("admin")) {
    throw new ApiError(403, "Only admins can view coupon details");
  }

  const { couponId } = req.params;

  if (!mongoose.Types.ObjectId.isValid(couponId)) {
    throw new ApiError(400, "Invalid coupon ID");
  }

  const coupon = await Coupon.findById(couponId)
    .populate("createdBy", "name email");

  if (!coupon) {
    throw new ApiError(404, "Coupon not found");
  }

  return res.status(200).json(
    new ApiResponse(200, coupon, "Coupon retrieved successfully")
  );
});

// Updates coupon details with audit logging (admin only)
const updateCoupon = asyncHandler(async (req, res) => {
  if (!req.user.roles?.includes("admin")) {
    throw new ApiError(403, "Only admins can update coupons");
  }

  const { couponId } = req.params;
  const {
    discountType,
    discountValue,
    minOrderAmount,
    usageLimit,
    perUserLimit,
    scope,
    productIds,
    sellerIds,
    isExclusive,
    startDate,
    endDate,
    isActive,
  } = req.body;

  if (!mongoose.Types.ObjectId.isValid(couponId)) {
    throw new ApiError(400, "Invalid coupon ID");
  }

  const coupon = await Coupon.findById(couponId);
  if (!coupon) {
    throw new ApiError(404, "Coupon not found");
  }

  const updateData = {};
  if (discountType) updateData.discountType = discountType;
  if (discountValue !== undefined) updateData.discountValue = discountValue;
  if (minOrderAmount !== undefined) updateData.minOrderAmount = minOrderAmount;
  if (usageLimit !== undefined) updateData.usageLimit = usageLimit;
  if (perUserLimit !== undefined) updateData.perUserLimit = perUserLimit;
  if (scope !== undefined) updateData.scope = scope;
  if (productIds !== undefined) updateData.productIds = productIds;
  if (sellerIds !== undefined) updateData.sellerIds = sellerIds;
  if (isExclusive !== undefined) updateData.isExclusive = isExclusive;
  if (startDate !== undefined) updateData.startDate = new Date(startDate);
  if (endDate !== undefined) updateData.endDate = endDate ? new Date(endDate) : null;
  if (isActive !== undefined) updateData.isActive = isActive;

  const updatedCoupon = await Coupon.findByIdAndUpdate(
    couponId,
    updateData,
    { new: true }
  );

  await auditLog(req.user._id, "COUPON_UPDATED", `Coupon ${coupon.code} updated`, {
    couponId,
  });

  return res.status(200).json(
    new ApiResponse(200, updatedCoupon, "Coupon updated successfully")
  );
});

// Deletes a coupon with audit logging (admin only)
const deleteCoupon = asyncHandler(async (req, res) => {
  if (!req.user.roles?.includes("admin")) {
    throw new ApiError(403, "Only admins can delete coupons");
  }

  const { couponId } = req.params;

  if (!mongoose.Types.ObjectId.isValid(couponId)) {
    throw new ApiError(400, "Invalid coupon ID");
  }

  const coupon = await Coupon.findById(couponId);
  if (!coupon) {
    throw new ApiError(404, "Coupon not found");
  }

  await Coupon.findByIdAndDelete(couponId);

  await auditLog(req.user._id, "COUPON_DELETED", `Coupon ${coupon.code} deleted`, {
    couponId,
  });

  return res.status(200).json(
    new ApiResponse(200, null, "Coupon deleted successfully")
  );
});

export {
  createCoupon,
  getAllCoupons,
  getActiveCoupons,
  validateCoupon,
  getCouponById,
  updateCoupon,
  deleteCoupon,
};

