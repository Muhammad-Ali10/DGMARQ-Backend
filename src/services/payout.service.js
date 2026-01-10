import { Payout } from '../models/payout.model.js';
import { Order } from '../models/order.model.js';
import { Seller } from '../models/seller.model.js';
import { User } from '../models/user.model.js';
import { SellerPayoutAccount } from '../models/sellerPayoutAccount.model.js';
import { createPayPalPayout } from './payment.service.js';
import { sendPayoutNotification } from './email.service.js';
import { createNotification } from './notification.service.js';
import { auditLog } from './audit.service.js';
import { PlatformSettings } from '../models/platform.model.js';
import { logger } from '../utils/logger.js';
import mongoose from 'mongoose';

const DEFAULT_COMMISSION_RATE = 0.1; // 10% default

// Retrieves commission rate from platform settings or returns default value
export const getCommissionRate = async () => {
  try {
    const setting = await PlatformSettings.findOne({ key: 'commission_rate' });
    if (setting && typeof setting.value === 'number' && setting.value >= 0 && setting.value <= 1) {
      return setting.value;
    }
  } catch (error) {
    logger.error('Failed to get commission rate from settings', error);
  }
  return DEFAULT_COMMISSION_RATE;
};

// Calculates commission amount based on current commission rate
export const calculateCommission = async (totalAmount) => {
  const commissionRate = await getCommissionRate();
  return totalAmount * commissionRate;
};

// Schedules a payout for seller with 15-day hold period
export const schedulePayout = async (payoutData, session = null) => {
  const { orderId, sellerId, amount, orderCompletedAt } = payoutData;

  // Use order completion date if provided, otherwise use current time
  const completionDate = orderCompletedAt ? new Date(orderCompletedAt) : new Date();
  const holdUntil = new Date(completionDate.getTime() + 15 * 24 * 60 * 60 * 1000);
  const grossAmount = amount;
  const commissionAmount = await calculateCommission(grossAmount);
  const netAmount = grossAmount - commissionAmount;

  const payoutDataToSave = {
    orderId: new mongoose.Types.ObjectId(orderId),
    sellerId: new mongoose.Types.ObjectId(sellerId),
    requestType: 'scheduled',
    grossAmount: grossAmount,
    commissionAmount: commissionAmount,
    netAmount: netAmount,
    currency: 'USD', // SECURITY: Hard-enforce USD currency
    status: 'pending',
    holdUntil: holdUntil,
  };

  if (session) {
    return await Payout.create([payoutDataToSave], { session });
  }
  return await Payout.create(payoutDataToSave);
};

// Processes scheduled payouts that are ready for release
export const processScheduledPayouts = async () => {
  const now = new Date();

  const pendingPayouts = await Payout.find({
    status: 'pending',
    requestType: 'scheduled',
    holdUntil: { $lte: now },
  }).populate('sellerId').populate('orderId');

  const results = {
    processed: 0,
    failed: 0,
    errors: [],
  };

  for (const payout of pendingPayouts) {
    try {
      const seller = payout.sellerId;
      
      const payoutAccount = await SellerPayoutAccount.findOne({ sellerId: seller._id });
      
      if (!payoutAccount) {
        payout.status = 'blocked';
        payout.notes = 'Payout account not linked';
        await payout.save();
        
        const sellerUser = await User.findById(seller.userId);
        if (sellerUser) {
          await createNotification(
            sellerUser._id,
            'payout',
            'Payout Blocked - Account Not Linked',
            `Your payout of $${payout.netAmount} is blocked because no payout account is linked. Please link a payout account to receive payouts.`,
            { payoutId: payout._id },
            '/seller/payout-account'
          );
        }
        
        results.errors.push({
          payoutId: payout._id,
          error: 'Payout account not linked',
        });
        results.failed++;
        continue;
      }
      
      if (payoutAccount.status === 'blocked') {
        payout.status = 'blocked';
        payout.notes = `Payout account blocked: ${payoutAccount.blockedReason || 'Blocked by admin'}`;
        await payout.save();
        
        const sellerUser = await User.findById(seller.userId);
        if (sellerUser) {
          await createNotification(
            sellerUser._id,
            'payout',
            'Payout Blocked - Account Blocked',
            `Your payout of $${payout.netAmount} is blocked because your payout account is blocked. Reason: ${payoutAccount.blockedReason || 'Contact admin'}`,
            { payoutId: payout._id },
            '/seller/payout-account'
          );
        }
        
        results.errors.push({
          payoutId: payout._id,
          error: 'Payout account is blocked',
        });
        results.failed++;
        continue;
      }
      
      if (payoutAccount.status !== 'verified') {
        payout.status = 'blocked';
        payout.notes = 'Payout account not verified';
        await payout.save();
        
        const sellerUser = await User.findById(seller.userId);
        if (sellerUser) {
          await createNotification(
            sellerUser._id,
            'payout',
            'Payout Blocked - Account Not Verified',
            `Your payout of $${payout.netAmount} is blocked because your payout account is not verified. Please wait for admin verification.`,
            { payoutId: payout._id },
            '/seller/payout-account'
          );
        }
        
        results.errors.push({
          payoutId: payout._id,
          error: 'Payout account not verified',
        });
        results.failed++;
        continue;
      }

      const sellerUser = await User.findById(seller.userId);
      if (!sellerUser) {
        results.errors.push({
          payoutId: payout._id,
          error: 'Seller user account not found',
        });
        results.failed++;
        continue;
      }

      const { decryptKey } = await import('../utils/encryption.js');
      let sellerEmail;
      try {
        sellerEmail = decryptKey(payoutAccount.encryptedAccountIdentifier);
      } catch (error) {
        logger.error(`Failed to decrypt account identifier for payout ${payout._id}`, error);
        payout.status = 'failed';
        payout.notes = 'Failed to decrypt payout account identifier';
        payout.failedReason = error.message;
        await payout.save();
        
        results.errors.push({
          payoutId: payout._id,
          error: 'Failed to decrypt account identifier',
        });
        results.failed++;
        continue;
      }
      
      if (!sellerEmail || sellerEmail === 'inactive') {
        payout.status = 'blocked';
        payout.notes = 'Payout account identifier missing';
        await payout.save();
        
        results.errors.push({
          payoutId: payout._id,
          error: 'Payout account identifier missing',
        });
        results.failed++;
        continue;
      }

      // FIX: Payout guardrails - validate amount format, check for refunds/disputes
      // Validate payout amount is 2 decimals, USD
      const payoutAmount = parseFloat(payout.netAmount.toFixed(2));
      if (isNaN(payoutAmount) || payoutAmount <= 0) {
        payout.status = 'blocked';
        payout.notes = 'Invalid payout amount';
        payout.failedReason = 'Payout amount must be a positive number';
        await payout.save();
        
        results.errors.push({
          payoutId: payout._id,
          error: 'Invalid payout amount',
        });
        results.failed++;
        continue;
      }

      if (payout.currency !== 'USD') {
        payout.status = 'blocked';
        payout.notes = 'Payout currency must be USD';
        payout.failedReason = `Invalid currency: ${payout.currency}`;
        await payout.save();
        
        results.errors.push({
          payoutId: payout._id,
          error: 'Payout currency must be USD',
        });
        results.failed++;
        continue;
      }

      // FIX: Check for refund/chargeback flags - do not payout if order has refunds/disputes
      const order = await Order.findById(payout.orderId);
      if (order) {
        // Check if order has any refunded items
        const hasRefundedItems = order.items.some(item => item.refunded === true);
        if (hasRefundedItems) {
          payout.status = 'blocked';
          payout.notes = 'Order has refunded items - payout blocked';
          payout.failedReason = 'Order contains refunded items';
          await payout.save();
          
          results.errors.push({
            payoutId: payout._id,
            error: 'Order has refunded items',
          });
          results.failed++;
          continue;
        }

        // Check if order payment status is refunded
        if (order.paymentStatus === 'refunded') {
          payout.status = 'blocked';
          payout.notes = 'Order is refunded - payout blocked';
          payout.failedReason = 'Order payment status is refunded';
          await payout.save();
          
          results.errors.push({
            payoutId: payout._id,
            error: 'Order is refunded',
          });
          results.failed++;
          continue;
        }

        // Check for open disputes
        const { Dispute } = await import('../models/dispute.model.js');
        const openDisputes = await Dispute.find({
          orderId: order._id,
          status: { $in: ['open', 'investigating'] },
        });

        if (openDisputes.length > 0) {
          payout.status = 'blocked';
          payout.notes = `Order has ${openDisputes.length} open dispute(s) - payout blocked`;
          payout.failedReason = 'Order has open disputes';
          await payout.save();
          
          results.errors.push({
            payoutId: payout._id,
            error: 'Order has open disputes',
            disputeCount: openDisputes.length,
          });
          results.failed++;
          continue;
        }
      }

      // FIX: Idempotency - check if payout already processed
      if (payout.status === 'released' && payout.paypalBatchId) {
        logger.warn(`Payout ${payout._id} already released (idempotent)`, {
          payoutId: payout._id,
          batchId: payout.paypalBatchId,
        });
        results.processed++;
        continue;
      }

      let paypalPayout;
      try {
        // FIX: Ensure amount is formatted to 2 decimals, USD
        paypalPayout = await createPayPalPayout(
          sellerEmail,
          payoutAmount, // Use validated 2-decimal amount
          'USD' // Hard-enforce USD
        );

        payout.status = 'released';
        payout.paypalBatchId = paypalPayout.batchId;
        payout.paypalItemId = paypalPayout.itemId;
        payout.paypalTransactionId = paypalPayout.batchId;
        payout.processedAt = new Date();
        await payout.save();

        // Log successful payout
        await auditLog(
          seller.userId,
          'PAYOUT_RELEASED',
          `Payout of $${payout.netAmount} released to seller`,
          {
            payoutId: payout._id,
            orderId: payout.orderId?._id || payout.orderId,
            paypalBatchId: paypalPayout.batchId,
            amount: payout.netAmount,
          }
        );
      } catch (paypalError) {
        // Handle PayPal API errors
        logger.error(`PayPal payout failed for payout ${payout._id}`, paypalError);
        
        // Check if error is due to invalid email/account
        const errorMessage = paypalError.message || '';
        if (errorMessage.includes('RECEIVER_UNREGISTERED') || 
            errorMessage.includes('INVALID_EMAIL') ||
            errorMessage.includes('RECEIVER_NOT_FOUND')) {
          // Mark payout account as potentially invalid
          const payoutAccount = await SellerPayoutAccount.findOne({ sellerId: seller._id });
          if (payoutAccount && payoutAccount.status === 'verified') {
            payoutAccount.status = 'pending';
            payoutAccount.notes = `Account validation failed during payout: ${errorMessage}`;
            await payoutAccount.save();
            
            // Notify admin
            const adminUsers = await User.find({ roles: "admin", isActive: true });
            for (const admin of adminUsers) {
              await createNotification(
                admin._id,
                "payout",
                "Payout Account Validation Failed",
                `Seller ${seller.shopName} payout failed due to invalid PayPal account. Please review.`,
                { sellerId: seller._id, accountId: payoutAccount._id, payoutId: payout._id },
                `/admin/sellers/${seller._id}/payout-account`
              );
            }
          }
        }
        
        payout.status = 'failed';
        payout.notes = `PayPal payout failed: ${errorMessage}`;
        payout.failedReason = errorMessage;
        payout.processedAt = new Date();
        await payout.save();
        
        // Log failed payout
        await auditLog(
          seller.userId,
          'PAYOUT_FAILED',
          `Payout of $${payout.netAmount} failed: ${errorMessage}`,
          {
            payoutId: payout._id,
            orderId: payout.orderId?._id || payout.orderId,
            error: errorMessage,
          }
        );
        
        throw paypalError; // Re-throw to be caught by outer try-catch
      }

      try {
        await sendPayoutNotification(payout, seller, sellerUser);
      } catch (emailError) {
        logger.error('Failed to send payout notification email', emailError);
      }
      
      await createNotification(
        sellerUser._id,
        'payout',
        'Payout Released',
        `Your payout of $${payout.netAmount} has been released successfully.`,
        { payoutId: payout._id },
        '/seller/payouts'
      );

      results.processed++;
    } catch (error) {
      logger.error(`Failed to process payout ${payout._id}`, error);
      
      // Check if we should retry (only for non-account-related errors)
      const errorMessage = error.message || '';
      const isAccountError = errorMessage.includes('RECEIVER_UNREGISTERED') || 
                            errorMessage.includes('INVALID_EMAIL') ||
                            errorMessage.includes('RECEIVER_NOT_FOUND') ||
                            errorMessage.includes('Payout account not linked') ||
                            errorMessage.includes('Payout account not verified');
      
      const shouldRetry = !isAccountError && payout.retryCount < (payout.maxRetries || 3);
      
      if (shouldRetry) {
        // Increment retry count and schedule retry
        payout.retryCount = (payout.retryCount || 0) + 1;
        payout.lastRetryAt = new Date();
        payout.status = 'pending'; // Keep as pending for retry
        payout.notes = `Processing failed (attempt ${payout.retryCount}/${payout.maxRetries || 3}): ${errorMessage}. Will retry.`;
        await payout.save();
        
        results.errors.push({
          payoutId: payout._id,
          error: error.message,
          willRetry: true,
          retryCount: payout.retryCount,
        });
      } else {
        // Max retries reached or account error, mark as failed
        payout.status = 'failed';
        payout.notes = isAccountError 
          ? `Processing failed: ${errorMessage}`
          : `Processing failed after ${payout.maxRetries || 3} attempts: ${errorMessage}`;
        payout.failedReason = errorMessage;
        payout.processedAt = new Date();
        await payout.save();
        
        // Notify seller of permanent failure (only if not account-related)
        if (!isAccountError) {
          const sellerUser = await User.findById(seller.userId);
          if (sellerUser) {
            await createNotification(
              sellerUser._id,
              'payout',
              'Payout Failed - Maximum Retries Reached',
              `Your payout of $${payout.netAmount} has failed after multiple attempts. Please contact support.`,
              { payoutId: payout._id },
              '/seller/payouts'
            );
          }
        }
        
        results.errors.push({
          payoutId: payout._id,
          error: error.message,
          willRetry: false,
        });
        results.failed++;
      }
    }
  }

  return results;
};

// Calculates seller's payout balance including pending, available, and paid amounts
export const getSellerBalance = async (sellerId) => {
  const now = new Date();

  // Available balance: Payouts that have passed the hold period (holdUntil <= now)
  const availablePayouts = await Payout.aggregate([
    {
      $match: {
        sellerId: new mongoose.Types.ObjectId(sellerId),
        status: 'pending',
        requestType: 'scheduled',
        holdUntil: { $lte: now }, // Only payouts past hold period
      },
    },
    {
      $group: {
        _id: null,
        totalAvailable: { $sum: '$netAmount' },
        totalCommission: { $sum: '$commissionAmount' },
        count: { $sum: 1 },
      },
    },
  ]);

  // Pending balance: Payouts still on hold (holdUntil > now or null)
  const pendingPayouts = await Payout.aggregate([
    {
      $match: {
        sellerId: new mongoose.Types.ObjectId(sellerId),
        status: 'pending',
        requestType: 'scheduled',
        $or: [
          { holdUntil: { $gt: now } }, // Still on hold
          { holdUntil: null }, // No hold date set (shouldn't happen but handle gracefully)
        ],
      },
    },
    {
      $group: {
        _id: null,
        totalPending: { $sum: '$netAmount' },
        totalCommission: { $sum: '$commissionAmount' },
        count: { $sum: 1 },
        earliestReleaseDate: { $min: '$holdUntil' }, // Earliest date when any payout becomes available
      },
    },
  ]);

  // Released balance: Already processed payouts
  const releasedPayouts = await Payout.aggregate([
    {
      $match: {
        sellerId: new mongoose.Types.ObjectId(sellerId),
        status: 'released',
      },
    },
    {
      $group: {
        _id: null,
        totalReleased: { $sum: '$netAmount' },
        count: { $sum: 1 },
      },
    },
  ]);

  const available = availablePayouts[0]?.totalAvailable || 0;
  const pendingAmount = pendingPayouts[0]?.totalPending || 0;
  const earliestReleaseDate = pendingPayouts[0]?.earliestReleaseDate;

  // Calculate days until next available payout
  let daysUntilAvailable = null;
  if (earliestReleaseDate) {
    const diffTime = earliestReleaseDate.getTime() - now.getTime();
    daysUntilAvailable = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  }

  return {
    available, // Available for withdrawal (past hold period)
    pending: {
      amount: pendingAmount, // On hold (not yet available)
      commission: pendingPayouts[0]?.totalCommission || 0,
      count: pendingPayouts[0]?.count || 0,
      earliestReleaseDate: earliestReleaseDate || null,
      daysUntilAvailable: daysUntilAvailable || 0,
    },
    released: {
      amount: releasedPayouts[0]?.totalReleased || 0,
      count: releasedPayouts[0]?.count || 0,
    },
    totalEarnings: available + pendingAmount + (releasedPayouts[0]?.totalReleased || 0),
  };
};

// Retrieves seller's payout history with pagination
export const getSellerPayouts = async (sellerId, page = 1, limit = 20) => {
  const skip = (page - 1) * limit;

  const payouts = await Payout.find({ sellerId })
    .populate('orderId', 'totalAmount createdAt')
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit);

  const total = await Payout.countDocuments({ sellerId });

  return {
    payouts,
    pagination: {
      page,
      limit,
      total,
      pages: Math.ceil(total / limit),
    },
  };
};

