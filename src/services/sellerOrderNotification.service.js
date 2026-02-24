import mongoose from 'mongoose';
import { Order } from '../models/order.model.js';
import { queueEmail } from '../jobs/email.job.js';
import { logger } from '../utils/logger.js';

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

  const uniqueSellerIds = [...new Set(
    (order.items || [])
      .map((item) => item?.sellerId?.toString?.())
      .filter(Boolean)
  )];

  for (const sellerId of uniqueSellerIds) {
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
  }
};

