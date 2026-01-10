import { BundleDeal } from "../models/bundledeal.model.js";

// Finds an active bundle deal for the given product IDs
export const findActiveBundleDeal = async (productIds) => {
  if (!productIds || productIds.length !== 2) {
    return null;
  }

  const now = new Date();

  const bundleDeal = await BundleDeal.findOne({
    isActive: true,
    startDate: { $lte: now },
    endDate: { $gte: now },
    products: { $all: productIds, $size: 2 },
  }).populate("products", "name price images slug");

  return bundleDeal;
};

// Calculates bundle discount amount based on discount type and value
export const calculateBundleDiscount = (bundleDeal, totalPrice) => {
  if (!bundleDeal || !totalPrice) {
    return 0;
  }

  const { discountType, discountValue } = bundleDeal;

  if (discountType === "percentage") {
    return (totalPrice * discountValue) / 100;
  } else if (discountType === "fixed") {
    return Math.min(discountValue, totalPrice);
  }

  return 0;
};

// Checks if cart items match a bundle deal and returns discount information
export const checkCartForBundle = async (cartItems) => {
  if (!cartItems || cartItems.length < 2) {
    return null;
  }

  const productIds = cartItems.map((item) => {
    const productId = item.productId?._id || item.productId;
    return productId?.toString();
  }).filter(Boolean);

  if (productIds.length !== 2) {
    return null;
  }

  const bundleDeal = await findActiveBundleDeal(productIds);

  if (!bundleDeal) {
    return null;
  }

  const totalPrice = cartItems.reduce((sum, item) => {
    const price = item.unitPrice || item.productId?.price || 0;
    const qty = item.qty || 1;
    return sum + price * qty;
  }, 0);

  const discountAmount = calculateBundleDiscount(bundleDeal, totalPrice);

  return {
    bundleDeal,
    discountAmount,
    originalTotal: totalPrice,
    discountedTotal: totalPrice - discountAmount,
  };
};

