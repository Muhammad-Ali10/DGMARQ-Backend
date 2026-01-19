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

// Creates a checkout session from cart with stock validation, discounts, and PayPal order creation
const createCheckoutSession = asyncHandler(async (req, res) => {
  const userId = req.user._id;
  const { couponCode } = req.body;

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
    
    const lineTotal = item.unitPrice * item.qty;
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
      unitPrice: item.unitPrice,
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
  // Calculate final amount: subtotal - all discounts
  // Formula: subtotal - bundleDiscount - subscriptionDiscount - couponDiscount
  // This matches: subtotalAfterSubscription - couponDiscount
  const totalAmount = subtotalAfterSubscription - couponDiscount;

  if (totalAmount <= 0) {
    throw new ApiError(400, 'Invalid total amount');
  }

  // Get wallet balance and calculate payment split
  const walletBalance = await getWalletBalance(userId);
  let walletAmount = 0;
  let cardAmount = totalAmount;
  let paymentMethod = "PayPal"; // Default

  // Wallet priority: Use wallet first, then card for remaining
  if (walletBalance > 0) {
    if (walletBalance >= totalAmount) {
      // Case 1: Wallet covers full amount
      walletAmount = totalAmount;
      cardAmount = 0;
      paymentMethod = "Wallet";
    } else {
      // Case 2: Wallet covers partial amount
      walletAmount = walletBalance;
      cardAmount = totalAmount - walletBalance;
      paymentMethod = "Wallet+Card";
    }
  }
  // Case 3: Wallet = 0, full payment via card (default)

  // REMOVED: PayPal order creation from checkout/create
  // PayPal orders are now created via unified endpoint: POST /api/v1/paypal/orders
  // This separates checkout session creation from payment order creation
  // Frontend should call /api/v1/paypal/orders with checkoutId after checkout session is created

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
    walletAmount,
    cardAmount,
    couponId,
    hasSubscription: hasSubscription,
    paymentMethod,
    paypalOrderId: null, // Will be set when PayPal order is created via /api/v1/paypal/orders
    paypalApprovalUrl: null, // Not needed for CardFields/Buttons flow
    status: 'pending',
    expiresAt: new Date(Date.now() + 30 * 60 * 1000), // 30 minutes
  });

  return res.status(201).json(
    new ApiResponse(201, {
      checkoutId: checkout._id,
      expiresAt: checkout.expiresAt,
      totalAmount: checkout.totalAmount,
      walletAmount: checkout.walletAmount,
      cardAmount: checkout.cardAmount,
      paymentMethod: checkout.paymentMethod,
      walletBalance, // Return current wallet balance for frontend display
      // Note: PayPal order creation happens via POST /api/v1/paypal/orders with checkoutId
    }, 'Checkout session created successfully')
  );
});

// Retrieves checkout session status by checkout ID
const getCheckoutStatus = asyncHandler(async (req, res) => {
  const { checkoutId } = req.params;
  const userId = req.user._id;

  if (!mongoose.Types.ObjectId.isValid(checkoutId)) {
    throw new ApiError(400, 'Invalid checkout ID');
  }

  const checkout = await Checkout.findOne({
    _id: checkoutId,
    userId,
  }).populate('items.productId').populate('couponId');

  if (!checkout) {
    throw new ApiError(404, 'Checkout session not found');
  }

  // Check if expired
  if (checkout.status === 'pending' && checkout.expiresAt < new Date()) {
    checkout.status = 'expired';
    await checkout.save();
  }

  return res.status(200).json(
    new ApiResponse(200, checkout, 'Checkout status retrieved successfully')
  );
});

/**
 * Cancel checkout session
 */
const cancelCheckout = asyncHandler(async (req, res) => {
  const { checkoutId } = req.params;
  const userId = req.user._id;

  if (!mongoose.Types.ObjectId.isValid(checkoutId)) {
    throw new ApiError(400, 'Invalid checkout ID');
  }

  const checkout = await Checkout.findOneAndUpdate(
    {
      _id: checkoutId,
      userId,
      status: 'pending',
    },
    {
      status: 'cancelled',
    },
    { new: true }
  );

  if (!checkout) {
    throw new ApiError(404, 'Checkout session not found or already processed');
  }

  return res.status(200).json(
    new ApiResponse(200, checkout, 'Checkout session cancelled successfully')
  );
});

/**
 * Complete checkout (called by PayPal webhook)
 */
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

  // This will be handled by the order controller after payment capture
  // For now, just mark as paid
  checkout.status = 'paid';
  await checkout.save();

  return res.status(200).json(
    new ApiResponse(200, { checkoutId: checkout._id }, 'Checkout completed')
  );
});

/**
 * REMOVED: processCardCheckout
 * 
 * SECURITY: Card data should NEVER be sent to our backend.
 * Card payments must use PayPal-hosted CardFields on frontend.
 * Backend only handles orderId for capture via /api/v1/paypal/orders/:orderId/capture
 */

export {
  createCheckoutSession,
  getCheckoutStatus,
  cancelCheckout,
  completeCheckout,
};
