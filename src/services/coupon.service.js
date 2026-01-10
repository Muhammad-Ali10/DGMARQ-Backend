import { Coupon } from "../models/coupon.model.js";
import { Order } from "../models/order.model.js";
import { CouponUsage } from "../models/couponUsage.model.js";
import mongoose from "mongoose";

// Validates coupon code with enhanced rules including subscription exclusivity, usage limits, and scope-based eligibility
export const validateCouponCode = async (code, orderAmount = 0, userId = null, productIds = [], sellerIds = [], hasSubscription = false) => {
  const coupon = await Coupon.findOne({ code: code.toUpperCase().trim() });

  if (!coupon) {
    return { valid: false, error: "Invalid coupon code" };
  }

  if (!coupon.isActive) {
    return { valid: false, error: "Coupon is not active" };
  }

  const now = new Date();
  if (coupon.startDate && coupon.startDate > now) {
    return { valid: false, error: "Coupon is not yet valid" };
  }

  if (coupon.endDate && coupon.endDate < now) {
    return { valid: false, error: "Coupon has expired" };
  }

  if (coupon.isExclusive && !hasSubscription) {
    return { valid: false, error: "This coupon is exclusive to DGMARQ+ subscribers" };
  }

  if (coupon.usageLimit > 0 && coupon.usedCount >= coupon.usageLimit) {
    return { valid: false, error: "Coupon usage limit reached" };
  }

  if (userId && coupon.perUserLimit > 0) {
    const userUsageCount = await CouponUsage.countDocuments({
      couponId: coupon._id,
      userId: new mongoose.Types.ObjectId(userId),
    });
    if (userUsageCount >= coupon.perUserLimit) {
      return { valid: false, error: "You have reached the maximum usage limit for this coupon" };
    }
  }

  if (coupon.minOrderAmount > 0 && orderAmount < coupon.minOrderAmount) {
    return {
      valid: false,
      error: `Minimum order amount of ${coupon.minOrderAmount} required`,
    };
  }

  if (coupon.scope === 'product' && coupon.productIds && coupon.productIds.length > 0) {
    const hasEligibleProduct = productIds.some(productId => 
      coupon.productIds.some(couponProductId => 
        couponProductId.toString() === productId.toString()
      )
    );
    if (!hasEligibleProduct) {
      return { valid: false, error: "This coupon is not valid for the selected products" };
    }
  }

  if (coupon.scope === 'seller' && coupon.sellerIds && coupon.sellerIds.length > 0) {
    const hasEligibleSeller = sellerIds.some(sellerId => 
      coupon.sellerIds.some(couponSellerId => 
        couponSellerId.toString() === sellerId.toString()
      )
    );
    if (!hasEligibleSeller) {
      return { valid: false, error: "This coupon is not valid for the selected sellers" };
    }
  }

  return { valid: true, coupon };
};

// Calculates discount amount based on coupon type (percentage or fixed)
export const calculateDiscount = (coupon, orderAmount) => {
  if (coupon.discountType === "percentage") {
    return (orderAmount * coupon.discountValue) / 100;
  } else {
    return Math.min(coupon.discountValue, orderAmount);
  }
};

// Applies coupon to an order, increments usage count, and tracks per-user usage
export const applyCoupon = async (couponId, orderId, userId) => {
  const coupon = await Coupon.findById(couponId);
  if (!coupon) {
    throw new Error("Coupon not found");
  }

  coupon.usedCount += 1;
  await coupon.save();

  if (userId) {
    await CouponUsage.create({
      couponId: coupon._id,
      userId: new mongoose.Types.ObjectId(userId),
      orderId: new mongoose.Types.ObjectId(orderId),
    });
  }

  await Order.findByIdAndUpdate(orderId, { couponId });

  return coupon;
};

// Retrieves coupon statistics including usage count and order statistics
export const getCouponStats = async (couponId) => {
  const coupon = await Coupon.findById(couponId);
  if (!coupon) {
    return null;
  }

  const ordersWithCoupon = await Order.countDocuments({ couponId });

  return {
    coupon,
    totalUsage: coupon.usedCount,
    ordersCount: ordersWithCoupon,
    remainingUsage: coupon.usageLimit > 0 ? coupon.usageLimit - coupon.usedCount : "Unlimited",
  };
};

