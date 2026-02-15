import { Notification } from '../models/notification.model.js';
import mongoose from 'mongoose';
import { logger } from '../utils/logger.js';

export const createNotification = async (userId, type, title, message, data = null, actionUrl = null, priority = 'medium') => {
  try {
    const notification = await Notification.create({
      userId: new mongoose.Types.ObjectId(userId),
      type,
      title,
      message,
      data,
      actionUrl,
      priority,
      isRead: false,
    });

    return notification;
  } catch (error) {
    logger.error('Failed to create notification', error);
    throw error;
  }
};

export const getUserNotifications = async (userId, page = 1, limit = 20, unreadOnly = false, type = null) => {
  const skip = (page - 1) * limit;

  const match = { userId: new mongoose.Types.ObjectId(userId) };
  if (unreadOnly) {
    match.isRead = false;
  }
  if (type) {
    match.type = type;
  }

  const notifications = await Notification.find(match)
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .lean();

  const total = await Notification.countDocuments(match);
  const unreadCount = await Notification.countDocuments({
    userId: new mongoose.Types.ObjectId(userId),
    isRead: false,
    ...(type ? { type } : {}),
  });

  return {
    notifications,
    pagination: {
      page,
      limit,
      total,
      pages: Math.ceil(total / limit),
    },
    unreadCount,
  };
};

export const markAsRead = async (notificationId, userId) => {
  const notification = await Notification.findOneAndUpdate(
    {
      _id: notificationId,
      userId: new mongoose.Types.ObjectId(userId),
    },
    {
      isRead: true,
      readAt: new Date(),
    },
    { new: true }
  );

  if (!notification) {
    throw new Error('Notification not found');
  }

  return notification;
};

export const markAllAsRead = async (userId) => {
  const result = await Notification.updateMany(
    {
      userId: new mongoose.Types.ObjectId(userId),
      isRead: false,
    },
    {
      isRead: true,
      readAt: new Date(),
    }
  );

  return result;
};

export const deleteNotification = async (notificationId, userId) => {
  const notification = await Notification.findOneAndDelete({
    _id: notificationId,
    userId: new mongoose.Types.ObjectId(userId),
  });

  if (!notification) {
    throw new Error('Notification not found');
  }

  return notification;
};

export const getUnreadCount = async (userId) => {
  const count = await Notification.countDocuments({
    userId: new mongoose.Types.ObjectId(userId),
    isRead: false,
  });

  return count;
};

export const notifyOrderCreated = async (userId, order) => {
  return await createNotification(
    userId,
    'order',
    'Order Confirmed',
    `Your order #${order._id} has been confirmed. License keys will be sent to your email.`,
    { orderId: order._id },
    `/orders/${order._id}`,
    'high'
  );
};

export const notifyPayoutProcessed = async (userId, payout) => {
  return await createNotification(
    userId,
    'payout',
    'Payout Processed',
    `Your payout of $${payout.netAmount.toFixed(2)} has been processed.`,
    { payoutId: payout._id, amount: payout.netAmount },
    `/payouts/${payout._id}`,
    'high'
  );
};

