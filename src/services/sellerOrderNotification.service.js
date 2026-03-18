import mongoose from 'mongoose';
import { Order } from '../models/order.model.js';
import { queueEmail } from '../jobs/email.job.js';
import { logger } from '../utils/logger.js';
import { Seller } from '../models/seller.model.js';
import { createNotification } from './notification.service.js';

const NOTIFIABLE_STATUSES = new Set(['paid', 'confirmed']);

export const queueSellerOrderNotifications = async (orderId) => {
  if (!orderId || !mongoose.Types.ObjectId.isValid(orderId)) {
    logger.warn('[SELLER ORDER EMAIL] Invalid orderId provided', { orderId });
    return;
  }

  const order = await Order.findById(orderId).select('paymentStatus items');
  if (!order) {
    logger.warn('[SELLER ORDER EMAIL] Order not found', { orderId: String(orderId) });
    return;
  }

  const paymentStatus = (order.paymentStatus || '').toLowerCase();
  if (!NOTIFIABLE_STATUSES.has(paymentStatus)) {
    logger.info('[SELLER ORDER EMAIL] Skipped due to payment status', {
      orderId: String(orderId),
      paymentStatus: order.paymentStatus,
    });
    return;
  }

  const items = Array.isArray(order.items) ? order.items : [];
  const uniqueSellerIds = [...new Set(
    items
      .map((item) => item?.sellerId?.toString?.())
      .filter(Boolean)
  )];

  for (const sellerId of uniqueSellerIds) {
    const sellerItems = items.filter(
      (item) => item?.sellerId?.toString?.() === sellerId
    );
    const totalQuantity = sellerItems.reduce(
      (sum, item) => sum + (item?.qty || 0),
      0
    );

    try {
      await queueEmail(
        'seller_new_order',
        { orderId: order._id.toString(), sellerId },
        { jobId: `seller_new_order:${order._id.toString()}:${sellerId}` }
      );
    } catch (error) {
      logger.error('[SELLER ORDER EMAIL] Failed to queue seller email', {
        orderId: order._id.toString(),
        sellerId,
        error: error.message,
      });
    }

    try {
      const seller = await Seller.findById(sellerId).select('userId shopName');
      const sellerUserId = seller?.userId;

      if (sellerUserId) {
        await createNotification(
          sellerUserId,
          'order',
          'New order received',
          `You have a new order with ${totalQuantity} item(s).`,
          {
            orderId: order._id,
            sellerId: seller._id,
          },
          `/seller/orders/${order._id}`,
          'high'
        );
      }
    } catch (error) {
      logger.error('[SELLER ORDER EMAIL] Failed to create seller notification', {
        orderId: order._id.toString(),
        sellerId,
        error: error.message,
      });
    }
  }
};

