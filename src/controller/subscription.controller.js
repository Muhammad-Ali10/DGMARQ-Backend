import mongoose from "mongoose";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { Subscription } from "../models/subscription.model.js";
import {
  hasActiveSubscription,
  getUserSubscription,
  createSubscription,
  createSubscriptionFromPayPal,
  cancelSubscription,
  renewSubscription,
} from "../services/subscription.service.js";
import { createPayPalSubscription, validatePlanIdFormat } from "../services/payment.service.js";
import { authorizeRoles } from "../middlerwares/authmiddlerware.js";

const getMySubscription = asyncHandler(async (req, res) => {
  const userId = req.user._id;

  const subscription = await getUserSubscription(userId);

  if (!subscription) {
    return res.status(200).json(
      new ApiResponse(200, { hasSubscription: false }, "No active subscription")
    );
  }

  return res.status(200).json(
    new ApiResponse(200, {
      hasSubscription: true,
      subscription,
    }, "Subscription retrieved successfully")
  );
});

const subscribe = asyncHandler(async (req, res) => {
  const userId = req.user._id;

  const existingSubscription = await getUserSubscription(userId);
  if (existingSubscription) {
    throw new ApiError(400, "You already have an active subscription");
  }

  const planId = (process.env.PAYPAL_SUBSCRIPTION_PLAN_ID || '').trim();
  if (!planId) {
    throw new ApiError(503, "Subscription is not configured. Set PAYPAL_SUBSCRIPTION_PLAN_ID (billing plan P-xxx) in server environment.");
  }
  const formatCheck = validatePlanIdFormat(planId);
  if (!formatCheck.valid) {
    throw new ApiError(400, formatCheck.error);
  }

  const returnUrl = `${process.env.FRONTEND_URL}/subscription/success`;
  const cancelUrl = `${process.env.FRONTEND_URL}/subscription/cancel`;

  const paypalSubscription = await createPayPalSubscription(planId, returnUrl, cancelUrl);

  const approvalLink = paypalSubscription.links?.find(link => link.rel === 'approve');

  return res.status(201).json(
    new ApiResponse(201, {
      subscriptionId: paypalSubscription.id,
      status: paypalSubscription.status,
      approvalUrl: approvalLink?.href,
      message: "Please approve the subscription in PayPal to activate it.",
    }, "Subscription initiated. Please approve in PayPal.")
  );
});

const confirmSubscription = asyncHandler(async (req, res) => {
  const userId = req.user._id;
  const { subscriptionId } = req.body;

  if (!subscriptionId) {
    throw new ApiError(400, "Subscription ID is required");
  }

  const subscription = await createSubscriptionFromPayPal(userId, subscriptionId);

  return res.status(201).json(
    new ApiResponse(201, subscription, "Subscription activated successfully")
  );
});

const cancelMySubscription = asyncHandler(async (req, res) => {
  const userId = req.user._id;

  const subscription = await cancelSubscription(userId);

  if (!subscription) {
    throw new ApiError(404, "No active subscription found");
  }

  return res.status(200).json(
    new ApiResponse(200, subscription, "Subscription cancelled successfully")
  );
});

const renewMySubscription = asyncHandler(async (req, res) => {
  const userId = req.user._id;
  const { durationMonths = 1 } = req.body;

  const subscription = await renewSubscription(userId, durationMonths);

  return res.status(200).json(
    new ApiResponse(200, subscription, "Subscription renewed successfully")
  );
});

const getAllSubscriptions = asyncHandler(async (req, res) => {
  const { page = 1, limit = 10, status } = req.query;

  const match = {};
  if (status) {
    match.status = status;
  }

  const subscriptions = await Subscription.find(match)
    .populate("userId", "name email")
    .sort({ createdAt: -1 })
    .skip((page - 1) * limit)
    .limit(parseInt(limit));

  const total = await Subscription.countDocuments(match);

  return res.status(200).json(
    new ApiResponse(200, {
      subscriptions,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit),
      },
    }, "Subscriptions retrieved successfully")
  );
});

const getSubscriptionStats = asyncHandler(async (req, res) => {
  const [active, expired, cancelled, total] = await Promise.all([
    Subscription.countDocuments({ status: 'active' }),
    Subscription.countDocuments({ status: 'expired' }),
    Subscription.countDocuments({ status: 'cancelled' }),
    Subscription.countDocuments(),
  ]);

  return res.status(200).json(
    new ApiResponse(200, {
      active,
      expired,
      cancelled,
      total,
    }, "Subscription statistics retrieved successfully")
  );
});

const getSubscriptionPlans = asyncHandler(async (req, res) => {
  const subscriptionPrice = parseFloat(process.env.SUBSCRIPTION_PRICE || '9.99');
  const discountPercentage = 2;

  const plan = {
    name: 'DGMARQ+',
    displayName: 'DGMarket Plus',
    price: subscriptionPrice,
    currency: 'EUR',
    duration: 'monthly',
    discountPercentage: discountPercentage,
    description: 'Monthly subscription to DGMARQ+ with 2% discount on all purchases',
    benefits: [
      '2% automatic discount on all purchases',
      'Discount applied after bundle deals',
      'Works with coupon codes',
      'Cancel anytime',
      'Instant activation after subscription',
    ],
  };

  return res.status(200).json(
    new ApiResponse(200, { plan }, "Subscription plan retrieved successfully")
  );
});

export {
  getMySubscription,
  subscribe,
  confirmSubscription,
  cancelMySubscription,
  renewMySubscription,
  getAllSubscriptions,
  getSubscriptionStats,
  getSubscriptionPlans,
};

