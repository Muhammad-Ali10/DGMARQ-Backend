import { Subscription } from '../models/subscription.model.js';
import { User } from '../models/user.model.js';
import { createPayPalSubscription, getPayPalSubscription, cancelPayPalSubscription } from './payment.service.js';
import { logger } from '../utils/logger.js';
import mongoose from 'mongoose';

const SUBSCRIPTION_DISCOUNT_PERCENTAGE = 2;

export const hasActiveSubscription = async (userId) => {
  const subscription = await Subscription.findOne({
    userId: new mongoose.Types.ObjectId(userId),
    status: 'active',
    $or: [
      { endDate: null },
      { endDate: { $gte: new Date() } }
    ]
  });

  return !!subscription;
};

export const getUserSubscription = async (userId) => {
  return await Subscription.findOne({
    userId: new mongoose.Types.ObjectId(userId),
    status: 'active',
    $or: [
      { endDate: null },
      { endDate: { $gte: new Date() } }
    ]
  });
};

export const calculateSubscriptionDiscount = (subtotal) => {
  return (subtotal * SUBSCRIPTION_DISCOUNT_PERCENTAGE) / 100;
};

export const createSubscription = async (userId, planName = 'DGMARQ+', paypalSubscriptionId = null) => {
  const startDate = new Date();
  const endDate = new Date();
  endDate.setMonth(endDate.getMonth() + 1);

  const subscription = await Subscription.create({
    userId: new mongoose.Types.ObjectId(userId),
    planName,
    startDate,
    endDate,
    status: 'active',
    paypalSubscriptionId,
    nextBillingDate: endDate,
  });

  return subscription;
};

export const createSubscriptionFromPayPal = async (userId, paypalSubscriptionId) => {
  try {
    const paypalSub = await getPayPalSubscription(paypalSubscriptionId);
    
    if (paypalSub.status !== 'ACTIVE') {
      throw new Error(`PayPal subscription is not active: ${paypalSub.status}`);
    }

    const startDate = new Date(paypalSub.start_time || new Date());
    const endDate = new Date(startDate);
    endDate.setMonth(endDate.getMonth() + 1);

    const subscription = await Subscription.create({
      userId: new mongoose.Types.ObjectId(userId),
      planName: 'DGMARQ+',
      startDate,
      endDate,
      status: 'active',
      paypalSubscriptionId: paypalSub.id,
      paypalPlanId: paypalSub.plan_id,
      nextBillingDate: endDate,
    });

    return subscription;
  } catch (error) {
    logger.error('Failed to create subscription from PayPal', error);
    throw error;
  }
};

export const cancelSubscription = async (userId, reason = 'User requested cancellation') => {
  const subscription = await Subscription.findOne({
    userId: new mongoose.Types.ObjectId(userId),
    status: 'active',
  });

  if (!subscription) {
    return null;
  }

  if (subscription.paypalSubscriptionId) {
    try {
      await cancelPayPalSubscription(subscription.paypalSubscriptionId, reason);
    } catch (error) {
      logger.error('Failed to cancel PayPal subscription', error);
    }
  }

  subscription.status = 'cancelled';
  subscription.cancelledAt = new Date();
  subscription.cancellationReason = reason;
  await subscription.save();

  return subscription;
};

export const renewSubscription = async (userId, durationMonths = 1) => {
  const subscription = await Subscription.findOne({
    userId: new mongoose.Types.ObjectId(userId),
    status: 'active',
  });

  if (!subscription) {
    throw new Error('No active subscription found');
  }

  const newEndDate = new Date(subscription.endDate || new Date());
  newEndDate.setMonth(newEndDate.getMonth() + durationMonths);
  
  subscription.endDate = newEndDate;
  subscription.nextBillingDate = newEndDate;
  subscription.status = 'active';
  await subscription.save();

  return subscription;
};

export const handleSubscriptionPaymentFailure = async (subscriptionId) => {
  const subscription = await Subscription.findById(subscriptionId);

  if (!subscription) {
    throw new Error('Subscription not found');
  }

  subscription.status = 'active';
  await subscription.save();

  return subscription;
};

export const updateExpiredSubscriptions = async () => {
  const now = new Date();
  const expiredSubscriptions = await Subscription.find({
    status: 'active',
    endDate: { $lt: now },
    paypalSubscriptionId: null,
  });

  for (const sub of expiredSubscriptions) {
    sub.status = 'expired';
    await sub.save();
  }

  return { modifiedCount: expiredSubscriptions.length };
};

