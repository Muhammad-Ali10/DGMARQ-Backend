import mongoose from "mongoose";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { Checkout } from "../models/checkout.model.js";
import { Cart } from "../models/cart.model.js";
import { Product } from "../models/product.model.js";
import { Coupon } from "../models/coupon.model.js";
import { LicenseKey } from "../models/licensekey.model.js";
import { createPayPalOrder } from "../services/payment.service.js";
import { validateCouponCode } from "../services/coupon.service.js";
import { hasActiveSubscription, calculateSubscriptionDiscount } from "../services/subscription.service.js";
import { getWalletBalance, debitWallet } from "../services/wallet.service.js";
import { Transaction } from "../models/transaction.model.js";
import { calculateBuyerHandlingFee, assertValidHandlingFeeConfig } from "../services/handlingFee.service.js";

// Purpose: Creates a checkout session from cart with stock validation and discount calculation
const createCheckoutSession = asyncHandler(async (req, res) => {
  const userId = req.user._id;
  const { couponCode, preferredPaymentMethod } = req.body;

  const cart = await Cart.findOne({ userId }).populate('items.productId', 'name images price sellerId').lean();
  
  if (!cart || !cart.items || cart.items.length === 0) {
    throw new ApiError(400, 'Cart is empty');
  }

  for (const item of cart.items) {
    const product = item.productId;
    if (!product) {
      throw new ApiError(404, `Product not found for item`);
    }

    const licenseKeyDoc = await LicenseKey.findOne({
      productId: product._id,
    });

    const availableKeys = licenseKeyDoc 
      ? licenseKeyDoc.keys.filter(key => !key.isUsed).length 
      : 0;

    if (availableKeys < item.qty) {
      throw new ApiError(400, `Insufficient stock for ${product.name}. Available: ${availableKeys}, Requested: ${item.qty}`);
    }
  }

  let subtotal = 0;
  const checkoutItems = [];
  const productIds = [];
  const sellerIds = [];

  for (const item of cart.items) {
    const product = item.productId;
    
    // Use discounted price from cart (item.unitPrice should already be discounted)
    // Fallback to originalPrice or product.price if unitPrice is missing (backward compatibility)
    const finalUnitPrice = item.unitPrice || item.discountedPrice || product.price;
    const originalPrice = item.originalPrice || product.price;
    const discountedPrice = item.discountedPrice || finalUnitPrice;
    const discountAmount = item.discountAmount || 0;
    const discountPercentage = item.discountPercentage || 0;
    const discountType = item.discountType || null;
    
    const lineTotal = finalUnitPrice * item.qty;
    subtotal += lineTotal;

    productIds.push(product._id);
    if (!sellerIds.includes(item.sellerId.toString())) {
      sellerIds.push(item.sellerId);
    }

    checkoutItems.push({
      productId: product._id,
      sellerId: item.sellerId,
      name: product.name,
      qty: item.qty,
      unitPrice: finalUnitPrice,
      originalPrice: originalPrice,
      discountedPrice: discountedPrice,
      discountAmount: discountAmount,
      discountPercentage: discountPercentage,
      discountType: discountType,
      lineTotal: lineTotal,
    });
  }

  const { checkCartForBundle, calculateBundleDiscount } = await import("../services/bundledeal.service.js");
  const bundleInfo = await checkCartForBundle(cart.items);
  
  let bundleDiscount = 0;
  let bundleDealId = null;
  if (bundleInfo) {
    bundleDiscount = calculateBundleDiscount(bundleInfo.bundleDeal, subtotal);
    bundleDealId = bundleInfo.bundleDeal._id;
  }

  const subtotalAfterBundle = subtotal - bundleDiscount;

  const hasSubscription = await hasActiveSubscription(userId);

  let subscriptionDiscount = 0;
  if (hasSubscription) {
    subscriptionDiscount = calculateSubscriptionDiscount(subtotalAfterBundle);
  }

  const subtotalAfterSubscription = subtotalAfterBundle - subscriptionDiscount;

  let couponDiscount = 0;
  let couponId = null;

  if (couponCode) {
    const validation = await validateCouponCode(
      couponCode,
      subtotalAfterSubscription,
      userId,
      productIds,
      sellerIds,
      hasSubscription
    );

    if (!validation.valid) {
      throw new ApiError(400, validation.error);
    }

    const coupon = validation.coupon;

    if (coupon.discountType === 'percentage') {
      couponDiscount = (subtotalAfterSubscription * coupon.discountValue) / 100;
    } else {
      couponDiscount = Math.min(coupon.discountValue, subtotalAfterSubscription);
    }

    if (couponDiscount > subtotalAfterSubscription) {
      couponDiscount = subtotalAfterSubscription;
    }

    couponId = coupon._id;
  }

  const totalDiscount = bundleDiscount + subscriptionDiscount + couponDiscount;
  const totalAmount = subtotalAfterSubscription - couponDiscount;

  if (totalAmount <= 0) {
    throw new ApiError(400, 'Invalid total amount');
  }

  await assertValidHandlingFeeConfig();
  const { buyerHandlingFee, grandTotal } = await calculateBuyerHandlingFee(totalAmount);

  const walletBalance = await getWalletBalance(userId);
  let walletAmount = 0;
  let cardAmount = grandTotal;
  let paymentMethod = "PayPal";

  const requestedMethod = preferredPaymentMethod || "PayPal";

  if (requestedMethod === "Wallet") {
    if (walletBalance <= 0) {
      throw new ApiError(400, 'Insufficient wallet balance. Please add funds to your wallet or choose another payment method.');
    }
    if (walletBalance < grandTotal) {
      throw new ApiError(400, `Insufficient wallet balance. Your balance is $${walletBalance.toFixed(2)}, but the total is $${grandTotal.toFixed(2)}. Please add funds or choose another payment method.`);
    }
    walletAmount = grandTotal;
    cardAmount = 0;
    paymentMethod = "Wallet";
  } else if (requestedMethod === "Wallet+Card") {
    if (walletBalance <= 0) {
      throw new ApiError(400, 'Insufficient wallet balance. Please add funds to your wallet or choose another payment method.');
    }
    if (walletBalance >= grandTotal) {
      walletAmount = grandTotal;
      cardAmount = 0;
      paymentMethod = "Wallet";
    } else {
      walletAmount = walletBalance;
      cardAmount = grandTotal - walletBalance;
      paymentMethod = "Wallet+Card";
    }
  } else {
    walletAmount = 0;
    cardAmount = grandTotal;
    paymentMethod = requestedMethod === "Card" ? "Card" : "PayPal";
  }

  const checkout = await Checkout.create({
    userId,
    items: checkoutItems,
    subtotal,
    discount: totalDiscount,
    bundleDiscount: bundleDiscount,
    bundleDealId: bundleDealId,
    subscriptionDiscount: subscriptionDiscount,
    couponDiscount: couponDiscount,
    totalAmount,
    buyerHandlingFee,
    grandTotal,
    walletAmount,
    cardAmount,
    couponId,
    hasSubscription: hasSubscription,
    paymentMethod,
    paypalOrderId: null,
    paypalApprovalUrl: null,
    status: 'pending',
    expiresAt: new Date(Date.now() + 30 * 60 * 1000),
  });

  return res.status(201).json(
    new ApiResponse(201, {
      checkoutId: checkout._id,
      expiresAt: checkout.expiresAt,
      totalAmount: checkout.totalAmount,
      buyerHandlingFee: checkout.buyerHandlingFee,
      grandTotal: checkout.grandTotal,
      walletAmount: checkout.walletAmount,
      cardAmount: checkout.cardAmount,
      paymentMethod: checkout.paymentMethod,
      walletBalance,
    }, 'Checkout session created successfully')
  );
});

// Purpose: Creates a guest checkout session (no login). Items from body, guestEmail required.
const createGuestCheckoutSession = asyncHandler(async (req, res) => {
  const { items: requestItems, guestEmail, couponCode } = req.body;

  const emailTrimmed = typeof guestEmail === 'string' ? guestEmail.trim() : '';
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailTrimmed || !emailRegex.test(emailTrimmed)) {
    throw new ApiError(400, 'Valid email is required for guest checkout');
  }

  if (!requestItems || !Array.isArray(requestItems) || requestItems.length === 0) {
    throw new ApiError(400, 'At least one item (productId and qty) is required');
  }

  const productIds = [];
  const sellerIds = [];
  let subtotal = 0;
  const checkoutItems = [];

  for (const entry of requestItems) {
    const productId = entry.productId;
    const qty = Math.max(1, parseInt(entry.qty, 10) || 1);
    if (!productId || !mongoose.Types.ObjectId.isValid(productId)) {
      throw new ApiError(400, `Invalid productId: ${productId}`);
    }

    const product = await Product.findById(productId).select('name price sellerId').lean();
    if (!product) {
      throw new ApiError(404, `Product not found: ${productId}`);
    }

    const licenseKeyDoc = await LicenseKey.findOne({ productId: product._id });
    const availableKeys = licenseKeyDoc ? licenseKeyDoc.keys.filter(k => !k.isUsed).length : 0;
    if (availableKeys < qty) {
      throw new ApiError(400, `Insufficient stock for ${product.name}. Available: ${availableKeys}, Requested: ${qty}`);
    }

    const unitPrice = product.price;
    const lineTotal = unitPrice * qty;
    subtotal += lineTotal;
    productIds.push(product._id);
    const sid = product.sellerId?.toString?.() || product.sellerId;
    if (sid && !sellerIds.includes(sid)) sellerIds.push(sid);

    checkoutItems.push({
      productId: product._id,
      sellerId: product.sellerId,
      name: product.name,
      qty,
      unitPrice,
      originalPrice: unitPrice,
      discountedPrice: unitPrice,
      discountAmount: 0,
      discountPercentage: 0,
      discountType: null,
      lineTotal,
    });
  }

  let couponDiscount = 0;
  let couponId = null;
  if (couponCode && typeof couponCode === 'string' && couponCode.trim()) {
    const validation = await validateCouponCode(
      couponCode.trim(),
      subtotal,
      null,
      productIds,
      sellerIds,
      false
    );
    if (validation.valid && validation.coupon) {
      const coupon = validation.coupon;
      if (coupon.discountType === 'percentage') {
        couponDiscount = (subtotal * coupon.discountValue) / 100;
      } else {
        couponDiscount = Math.min(coupon.discountValue, subtotal);
      }
      if (couponDiscount > subtotal) couponDiscount = subtotal;
      couponId = coupon._id;
    }
  }

  const totalAmount = Math.round((subtotal - couponDiscount) * 100) / 100;
  if (totalAmount <= 0) {
    throw new ApiError(400, 'Invalid total amount');
  }

  await assertValidHandlingFeeConfig();
  const { buyerHandlingFee, grandTotal } = await calculateBuyerHandlingFee(totalAmount);

  const checkout = await Checkout.create({
    userId: null,
    isGuest: true,
    guestEmail: emailTrimmed.toLowerCase(),
    items: checkoutItems,
    subtotal,
    discount: couponDiscount,
    bundleDiscount: 0,
    subscriptionDiscount: 0,
    couponDiscount,
    totalAmount,
    buyerHandlingFee,
    grandTotal,
    walletAmount: 0,
    cardAmount: grandTotal,
    couponId,
    hasSubscription: false,
    paymentMethod: 'PayPal',
    paypalOrderId: null,
    paypalApprovalUrl: null,
    status: 'pending',
    expiresAt: new Date(Date.now() + 30 * 60 * 1000),
  });

  return res.status(201).json(
    new ApiResponse(201, {
      checkoutId: checkout._id,
      expiresAt: checkout.expiresAt,
      totalAmount: checkout.totalAmount,
      buyerHandlingFee: checkout.buyerHandlingFee,
      grandTotal: checkout.grandTotal,
      paymentMethod: checkout.paymentMethod,
      isGuest: true,
    }, 'Guest checkout session created successfully')
  );
});

// Purpose: Retrieves checkout session status by checkout ID (authenticated or guest by id)
const getCheckoutStatus = asyncHandler(async (req, res) => {
  const { checkoutId } = req.params;
  const isAuthenticated = !!req.user;

  if (!mongoose.Types.ObjectId.isValid(checkoutId)) {
    throw new ApiError(400, 'Invalid checkout ID');
  }

  let checkout;
  if (isAuthenticated) {
    checkout = await Checkout.findOne({
      _id: checkoutId,
      userId: req.user._id,
    }).populate('items.productId').populate('couponId');
  } else {
    checkout = await Checkout.findOne({
      _id: checkoutId,
      isGuest: true,
    }).populate('items.productId').populate('couponId');
  }

  if (!checkout) {
    throw new ApiError(404, 'Checkout session not found');
  }

  if (checkout.status === 'pending' && checkout.expiresAt < new Date()) {
    checkout.status = 'expired';
    await checkout.save();
  }

  return res.status(200).json(
    new ApiResponse(200, checkout, 'Checkout status retrieved successfully')
  );
});

// Purpose: Cancels a pending checkout session (authenticated or guest)
const cancelCheckout = asyncHandler(async (req, res) => {
  const { checkoutId } = req.params;
  const isAuthenticated = !!req.user;

  if (!mongoose.Types.ObjectId.isValid(checkoutId)) {
    throw new ApiError(400, 'Invalid checkout ID');
  }

  const query = { _id: checkoutId, status: 'pending' };
  if (isAuthenticated) {
    query.userId = req.user._id;
  } else {
    query.isGuest = true;
  }

  const checkout = await Checkout.findOneAndUpdate(
    query,
    { status: 'cancelled' },
    { new: true }
  );

  if (!checkout) {
    throw new ApiError(404, 'Checkout session not found or already processed');
  }

  return res.status(200).json(
    new ApiResponse(200, checkout, 'Checkout session cancelled successfully')
  );
});

// Purpose: Completes checkout after payment confirmation
const completeCheckout = asyncHandler(async (req, res) => {
  const { checkoutId, paypalOrderId } = req.body;

  if (!checkoutId || !paypalOrderId) {
    throw new ApiError(400, 'Checkout ID and PayPal Order ID are required');
  }

  const checkout = await Checkout.findById(checkoutId);

  if (!checkout) {
    throw new ApiError(404, 'Checkout session not found');
  }

  if (checkout.status !== 'pending') {
    throw new ApiError(400, 'Checkout session already processed');
  }

  checkout.status = 'paid';
  await checkout.save();

  return res.status(200).json(
    new ApiResponse(200, { checkoutId: checkout._id }, 'Checkout completed')
  );
});

// Purpose: Gets handling fee estimate for a given amount for checkout UI display
const getHandlingFeeEstimate = asyncHandler(async (req, res) => {
  const amount = parseFloat(req.query.amount);
  if (Number.isNaN(amount) || amount < 0) {
    return res.status(200).json(
      new ApiResponse(200, { enabled: false, buyerHandlingFee: 0, grandTotal: amount || 0, feeLabel: null }, 'Handling fee estimate')
    );
  }
  const { calculateBuyerHandlingFee } = await import('../services/handlingFee.service.js');
  const { buyerHandlingFee, grandTotal, config } = await calculateBuyerHandlingFee(amount);
  const feeLabel = config.enabled
    ? config.feeType === 'percentage'
      ? `${config.percentageValue}%`
      : `$${(config.fixedAmount || 0).toFixed(2)}`
    : null;
  return res.status(200).json(
    new ApiResponse(200, {
      enabled: config.enabled,
      buyerHandlingFee,
      grandTotal,
      feeLabel,
    }, 'Handling fee estimate')
  );
});

export {
  createCheckoutSession,
  createGuestCheckoutSession,
  getCheckoutStatus,
  cancelCheckout,
  completeCheckout,
  getHandlingFeeEstimate,
};
