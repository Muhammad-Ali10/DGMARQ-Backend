import { Queue, Worker } from 'bullmq';
import mongoose from 'mongoose';
import { connection } from './payout.job.js';
import { sendLicenseKeyEmail, sendLicenseKeyEmailToGuest, sendOrderConfirmation, sendPayoutNotification } from '../services/email.service.js';
import { Order } from '../models/order.model.js';
import { User } from '../models/user.model.js';
import { Payout } from '../models/payout.model.js';
import { Seller } from '../models/seller.model.js';
import { logger } from '../utils/logger.js';

const isRedisAvailable = !!process.env.REDIS_URL;

let emailQueue = null;
let emailWorker = null;

if (isRedisAvailable) {
  try {
    emailQueue = new Queue('email-processing', { connection });
    
    emailWorker = new Worker(
      'email-processing',
      async (job) => {
        const { type, data } = job.data;
        
        try {
          await processEmailJob(type, data);
          return { success: true, type, data };
        } catch (error) {
          logger.error(`Email job failed for type ${type}:`, error);
          throw error;
        }
      },
      { 
        connection,
        concurrency: 5,
      }
    );

    emailWorker.on('completed', (job) => {
      logger.info(`Email job ${job.id} completed: ${job.data.type}`);
    });

    emailWorker.on('failed', (job, err) => {
      logger.error(`Email job ${job.id} failed:`, err);
    });
    
    logger.info('Email queue and worker initialized with Redis');
  } catch (error) {
    logger.error('Failed to initialize email queue with Redis:', error);
    logger.warn('Emails will be sent directly (synchronously)');
  }
} else {
  logger.warn('Redis not configured - emails will be sent directly (synchronously)');
}

// Purpose: Processes email jobs by type and sends appropriate emails
const processEmailJob = async (type, data) => {
  switch (type) {
    case 'license_key':
      if (!data.orderId || !mongoose.Types.ObjectId.isValid(data.orderId)) {
        throw new Error(`Invalid orderId: ${data.orderId}`);
      }
      if (!data.userId || !mongoose.Types.ObjectId.isValid(data.userId)) {
        throw new Error(`Invalid userId: ${data.userId}`);
      }
      
      const order = await Order.findById(data.orderId).populate('items.productId', 'name images description productType');
      const user = await User.findById(data.userId);
      
      if (!order) {
        throw new Error(`Order not found: ${data.orderId}`);
      }
      if (!user) {
        throw new Error(`User not found: ${data.userId}`);
      }
      
      await sendLicenseKeyEmail(order, user);
      break;
      
    case 'license_key_guest':
      if (!data.orderId || !mongoose.Types.ObjectId.isValid(data.orderId)) {
        throw new Error(`Invalid orderId: ${data.orderId}`);
      }
      if (!data.guestEmail || typeof data.guestEmail !== 'string' || !data.guestEmail.trim()) {
        throw new Error(`Invalid guestEmail: ${data.guestEmail}`);
      }
      const guestOrder = await Order.findById(data.orderId).populate('items.productId', 'name images productType');
      if (!guestOrder) {
        throw new Error(`Order not found: ${data.orderId}`);
      }
      if (!guestOrder.isGuest) {
        throw new Error(`Order is not a guest order: ${data.orderId}`);
      }
      await sendLicenseKeyEmailToGuest(guestOrder, data.guestEmail.trim().toLowerCase());
      break;

    case 'order_confirmation':
      if (!data.orderId || !mongoose.Types.ObjectId.isValid(data.orderId)) {
        throw new Error(`Invalid orderId: ${data.orderId}`);
      }
      if (!data.userId || !mongoose.Types.ObjectId.isValid(data.userId)) {
        throw new Error(`Invalid userId: ${data.userId}`);
      }
      
      const orderForConfirmation = await Order.findById(data.orderId)
        .populate('items.productId', 'name images')
        .populate('items.sellerId', 'shopName');
      const userForConfirmation = await User.findById(data.userId);
      
      if (!orderForConfirmation) {
        throw new Error(`Order not found: ${data.orderId}`);
      }
      if (!userForConfirmation) {
        throw new Error(`User not found: ${data.userId}`);
      }
      
      await sendOrderConfirmation(orderForConfirmation, userForConfirmation);
      break;
      
    case 'payout_notification':
      if (!data.payoutId || !mongoose.Types.ObjectId.isValid(data.payoutId)) {
        throw new Error(`Invalid payoutId: ${data.payoutId}`);
      }
      
      const payout = await Payout.findById(data.payoutId).populate('sellerId');
      if (!payout) {
        throw new Error(`Payout not found: ${data.payoutId}`);
      }
      if (!payout.sellerId) {
        throw new Error(`Payout has no seller: ${data.payoutId}`);
      }
      
      const sellerUser = await User.findById(payout.sellerId.userId);
      if (!sellerUser) {
        throw new Error(`Seller user not found for payout: ${data.payoutId}`);
      }
      
      await sendPayoutNotification(payout, payout.sellerId, sellerUser);
      break;
      
    default:
      throw new Error(`Unknown email type: ${type}`);
  }
};

// Purpose: Queues email job or sends directly if Redis unavailable
export const queueEmail = async (type, data) => {
  if (!isRedisAvailable || !emailQueue) {
    logger.info(`Sending email directly (Redis not available): ${type}`);
    try {
      await processEmailJob(type, data);
      return { success: true, sent: true, method: 'direct' };
    } catch (error) {
      logger.error(`Failed to send email directly (${type}):`, error);
      throw error;
    }
  }

  try {
    const job = await emailQueue.add(type, { type, data }, {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 2000,
      },
      removeOnComplete: {
        age: 24 * 3600,
        count: 1000,
      },
      removeOnFail: {
        age: 7 * 24 * 3600,
      },
    });
    logger.debug(`Email queued: ${type}`, { jobId: job.id });
    return job;
  } catch (error) {
    logger.error(`Failed to queue email (${type}), trying direct send:`, error);
    try {
      await processEmailJob(type, data);
      return { success: true, sent: true, method: 'direct-fallback' };
    } catch (directError) {
      logger.error(`Failed to send email directly after queue failure (${type}):`, directError);
      throw directError;
    }
  }
};

