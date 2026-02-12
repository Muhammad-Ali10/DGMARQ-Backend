import { Payout } from '../models/payout.model.js';
import { Order } from '../models/order.model.js';
import { ReturnRefund } from '../models/returnrefund.model.js';
import { Seller } from '../models/seller.model.js';
import { User } from '../models/user.model.js';
import { SellerPayoutAccount } from '../models/sellerPayoutAccount.model.js';
import { createPayPalPayout } from './payment.service.js';
import { sendPayoutNotification } from './email.service.js';
import { createNotification } from './notification.service.js';
import { auditLog } from './audit.service.js';
import { PlatformSettings } from '../models/platform.model.js';
import { PAYOUT_HOLD_DAYS } from '../constants.js';
import { logger } from '../utils/logger.js';
import mongoose from 'mongoose';

const DEFAULT_COMMISSION_RATE = 0.1; // 10% default

// Purpose: Payout is allowed only if ALL are true (strict eligibility). PayPal OAuth mandatory; email-only invalid.
export const isPayoutEligible = (seller) => {
  if (!seller) return false;
  return (
    seller.paypalOAuthConnected === true &&
    seller.paypalVerified === true &&
    (seller.paypalMerchantId != null && seller.paypalMerchantId !== '') &&
    seller.paymentsReceivable === true &&
    seller.accountBlocked !== true
  );
};

// Purpose: Log every payout attempt for audit (sellerId, amount, status, failureReason)
const logPayoutAttempt = (sellerId, payoutAmount, payoutStatus, failureReason = null) => {
  const payload = {
    sellerId: sellerId?.toString?.(),
    payoutAmount,
    payoutStatus, // 'success' | 'blocked' | 'failed'
    failureReason: failureReason || undefined,
  };
  logger.info('[PAYOUT_ATTEMPT]', payload);
};

// Purpose: Retrieves commission rate from platform settings or returns default value
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

// Purpose: Calculates commission amount based on current or overridden commission rate
export const calculateCommission = async (totalAmount, commissionRateOverride = null) => {
  let commissionRate = commissionRateOverride;
  if (typeof commissionRate !== 'number' || commissionRate < 0) {
    commissionRate = await getCommissionRate();
  }
  return totalAmount * commissionRate;
};

// Purpose: Schedules a payout for seller with 15-day hold period (escrow model).
// Only call after payment is captured and order is completed; failed/pending payments must NOT trigger this.
export const schedulePayout = async (payoutData, session = null) => {
  const { orderId, sellerId, amount, orderCompletedAt, commissionRateOverride = null } = payoutData;

  const completionDate = orderCompletedAt ? new Date(orderCompletedAt) : new Date();
  const holdDays = (typeof PAYOUT_HOLD_DAYS === 'number' && PAYOUT_HOLD_DAYS >= 0) ? PAYOUT_HOLD_DAYS : 15;
  const holdUntil = new Date(completionDate.getTime() + holdDays * 24 * 60 * 60 * 1000);
  // Payout amount excludes platform commission; buyer handling fees are order-level and not part of seller line total
  const grossAmount = amount;
  const commissionAmount = await calculateCommission(grossAmount, commissionRateOverride);
  const netAmount = grossAmount - commissionAmount;

  const payoutDataToSave = {
    orderId: new mongoose.Types.ObjectId(orderId),
    sellerId: new mongoose.Types.ObjectId(sellerId),
    requestType: 'scheduled',
    grossAmount: grossAmount,
    commissionAmount: commissionAmount,
    netAmount: netAmount,
    currency: 'USD',
    status: 'pending',
    holdUntil: holdUntil,
  };

  if (session) {
    return await Payout.create([payoutDataToSave], { session });
  }
  return await Payout.create(payoutDataToSave);
};

// Purpose: Adjust existing scheduled payout for partial refund (no new payout record). Used when payout is still within hold period.
export const adjustPayoutForRefund = async (orderId, sellerId, deductGross, deductCommission, deductNet, refundedLicenseKeyIds = [], session = null) => {
  const orderIdObj = mongoose.Types.ObjectId.isValid(orderId) ? new mongoose.Types.ObjectId(orderId) : orderId;
  const sellerIdObj = mongoose.Types.ObjectId.isValid(sellerId) ? new mongoose.Types.ObjectId(sellerId) : sellerId;
  const payouts = await Payout.find({
    orderId: orderIdObj,
    sellerId: sellerIdObj,
    requestType: 'scheduled',
    status: { $in: ['pending', 'hold'] },
  }).session(session || null);

  if (!payouts || payouts.length === 0) return null;
  const payout = payouts[0];
  const existingMeta = payout.metadata && typeof payout.metadata === 'object' ? payout.metadata : {};
  const existingKeyIds = Array.isArray(existingMeta.refundedLicenseKeyIds) ? existingMeta.refundedLicenseKeyIds : [];
  const keyIds = refundedLicenseKeyIds.map(id => (id && id.toString ? id.toString() : id));
  const mergedKeyIds = [...new Set([...existingKeyIds, ...keyIds])];

  payout.grossAmount = Math.round((payout.grossAmount - deductGross) * 100) / 100;
  payout.commissionAmount = Math.round((payout.commissionAmount - deductCommission) * 100) / 100;
  payout.netAmount = Math.round((payout.netAmount - deductNet) * 100) / 100;
  payout.metadata = {
    ...existingMeta,
    adjustedForRefund: true,
    refundedLicenseKeyIds: mergedKeyIds,
  };
  payout.notes = (payout.notes || '') ? `${payout.notes}; Adjusted for refund.` : 'Adjusted for partial refund.';
  // Full refund (or multiple partials) can reduce net to zero: block payout so cron never releases it
  if (payout.netAmount <= 0) {
    payout.status = 'blocked';
    payout.blockReason = payout.netAmount === 0
      ? 'Fully adjusted for refund(s) – payout cancelled'
      : 'Invalid payout amount after refund adjustment';
    payout.notes = (payout.notes || '') + (payout.netAmount === 0 ? ' Payout cancelled (zero net).' : '');
  }
  if (session) {
    await payout.save({ session });
  } else {
    await payout.save();
  }
  return payout;
};

// Purpose: Block all pending/hold payouts for an order (e.g. when order is fully refunded). Ensures no release until dispute/refund resolved.
export const blockPayoutsForOrder = async (orderId, reason = 'Order fully refunded – payout cancelled', session = null) => {
  const orderIdObj = mongoose.Types.ObjectId.isValid(orderId) ? new mongoose.Types.ObjectId(orderId) : orderId;
  const result = await Payout.updateMany(
    {
      orderId: orderIdObj,
      requestType: 'scheduled',
      status: { $in: ['pending', 'hold'] },
    },
    {
      $set: {
        status: 'blocked',
        blockReason: reason,
        notes: reason,
      },
    },
    { session: session || undefined }
  );
  if (result.modifiedCount > 0) {
    logger.info('[PAYOUT] Blocked payouts for order (full refund)', { orderId: orderIdObj, count: result.modifiedCount });
  }
  return result;
};

// Purpose: Processes scheduled payouts that are ready for release after hold period. Includes blocked payouts for re-check (auto-process when fixed).
// Enforces: payout only when order paid+completed, no open dispute, no refunded order.
export const processScheduledPayouts = async () => {
  const now = new Date();

  const pendingPayouts = await Payout.find({
    status: { $in: ['pending', 'blocked'] },
    requestType: 'scheduled',
    holdUntil: { $lte: now },
  }).populate('sellerId').populate('orderId');

  const results = {
    processed: 0,
    failed: 0,
    errors: [],
  };

  for (const payout of pendingPayouts) {
    const payoutAmount = parseFloat(payout.netAmount.toFixed(2));
    try {
      let seller = payout.sellerId;
      // Re-check seller status at payout time (never release if seller became blocked or PayPal invalid)
      seller = await Seller.findById(seller._id);
      if (!seller) {
        logPayoutAttempt(payout.sellerId?.toString?.(), payoutAmount, 'blocked', 'Seller not found');
        payout.status = 'blocked';
        payout.blockReason = 'Seller not found';
        payout.notes = 'Seller not found';
        await payout.save();
        results.failed++;
        continue;
      }

      const orderId = payout.orderId?._id || payout.orderId;
      const order = await Order.findById(orderId).select('paymentStatus orderStatus').lean();
      // Status sync: do not release if order is refunded or not in a valid paid state
      if (!order || order.paymentStatus !== 'paid') {
        const blockReason = !order ? 'Order not found' : order.paymentStatus === 'refunded' ? 'Order fully refunded – payout blocked' : `Order payment status: ${order.paymentStatus}`;
        logPayoutAttempt(payout.sellerId?.toString?.(), payoutAmount, 'blocked', blockReason);
        payout.status = 'blocked';
        payout.blockReason = blockReason;
        payout.notes = blockReason;
        await payout.save();
        results.errors.push({ payoutId: payout._id, error: blockReason });
        results.failed++;
        continue;
      }

      // Dispute handling: block payout if order has an open refund request (no release until dispute resolved)
      const openRefund = await ReturnRefund.findOne({
        orderId,
        status: { $in: ['PENDING', 'SELLER_REVIEW', 'SELLER_APPROVED', 'ADMIN_REVIEW', 'ADMIN_APPROVED', 'ON_HOLD_INSUFFICIENT_FUNDS', 'WAITING_FOR_MANUAL_REFUND'] },
      });
      if (openRefund) {
        const blockReason = 'Order has open refund request – payout held until dispute resolved';
        logPayoutAttempt(payout.sellerId?.toString?.(), payoutAmount, 'blocked', blockReason);
        payout.status = 'blocked';
        payout.blockReason = blockReason;
        payout.notes = blockReason;
        await payout.save();
        results.errors.push({ payoutId: payout._id, error: blockReason });
        results.failed++;
        continue;
      }

      // Blocked payouts: re-check eligibility and that order has no refunded items; if eligible and no refunds, set to pending and process (funds never removed)
      if (payout.status === 'blocked') {
        if (!isPayoutEligible(seller)) {
          results.failed++;
          continue;
        }
        if (order && order.paymentStatus === 'refunded') {
          payout.blockReason = 'Order fully refunded - payout blocked';
          payout.notes = payout.blockReason;
          await payout.save();
          results.errors.push({ payoutId: payout._id, error: payout.blockReason });
          results.failed++;
          continue;
        }
        payout.status = 'pending';
        payout.blockReason = null;
        payout.notes = '';
        await payout.save();
      }

      if (!isPayoutEligible(seller)) {
        const reason = !seller.paypalOAuthConnected
          ? 'PayPal OAuth not connected'
          : !seller.paypalVerified
            ? 'PayPal account not verified or not eligible to receive payments'
            : !seller.paypalMerchantId
              ? 'PayPal merchant ID missing – connect PayPal (OAuth). Email-only is not accepted.'
              : seller.paymentsReceivable !== true
                ? 'PayPal account cannot receive payments'
                : seller.accountBlocked
                  ? 'Account blocked'
                  : 'Seller not eligible for payout';
        logPayoutAttempt(seller._id, payoutAmount, 'blocked', reason);
        payout.status = 'blocked';
        payout.blockReason = reason;
        payout.notes = reason;
        await payout.save();
        const sellerUser = await User.findById(seller.userId);
        if (sellerUser) {
          await createNotification(
            sellerUser._id,
            'payout',
            'Payout On Hold',
            `Your payout of $${payout.netAmount} is on hold: ${reason}. Connect and verify PayPal or contact support.`,
            { payoutId: payout._id },
            '/seller/payout-account'
          );
        }
        results.errors.push({ payoutId: payout._id, error: reason });
        results.failed++;
        continue;
      }

      if (!seller.paypalMerchantId) {
        const reason = 'PayPal merchant ID missing – payouts require Connect PayPal (OAuth). Email-only is not accepted.';
        logPayoutAttempt(seller._id, payoutAmount, 'blocked', reason);
        payout.status = 'blocked';
        payout.blockReason = reason;
        payout.notes = reason;
        await payout.save();
        const sellerUser = await User.findById(seller.userId);
        if (sellerUser) {
          await createNotification(
            sellerUser._id,
            'payout',
            'Payout Blocked - Connect PayPal',
            `Your payout of $${payout.netAmount} cannot be sent. Please connect your PayPal account via "Connect PayPal" (email-only is not accepted).`,
            { payoutId: payout._id },
            '/seller/payout-account'
          );
        }
        results.errors.push({ payoutId: payout._id, error: reason });
        results.failed++;
        continue;
      }

      const sellerUser = await User.findById(seller.userId);
      if (!sellerUser) {
        logPayoutAttempt(seller._id, payoutAmount, 'failed', 'Seller user account not found');
        results.errors.push({
          payoutId: payout._id,
          error: 'Seller user account not found',
        });
        results.failed++;
        continue;
      }

      if (isNaN(payoutAmount) || payoutAmount <= 0) {
        payout.status = 'blocked';
        payout.blockReason = payoutAmount === 0 ? 'Fully adjusted for refund(s)' : 'Invalid payout amount';
        payout.notes = payoutAmount === 0 ? 'Payout reduced to zero by refund(s).' : 'Invalid payout amount';
        payout.failedReason = payoutAmount <= 0 ? 'Payout amount must be a positive number' : undefined;
        await payout.save();
        logPayoutAttempt(seller._id, payoutAmount, 'blocked', payout.blockReason);
        results.errors.push({ payoutId: payout._id, error: payout.blockReason });
        results.failed++;
        continue;
      }

      if (payout.currency !== 'USD') {
        payout.status = 'blocked';
        payout.blockReason = `Invalid currency: ${payout.currency}`;
        payout.notes = 'Payout currency must be USD';
        payout.failedReason = `Invalid currency: ${payout.currency}`;
        await payout.save();
        logPayoutAttempt(seller._id, payoutAmount, 'blocked', `Invalid currency: ${payout.currency}`);
        results.errors.push({ payoutId: payout._id, error: 'Payout currency must be USD' });
        results.failed++;
        continue;
      }

      // Order already validated above (paymentStatus === 'paid', no open dispute)

      if (payout.status === 'released' && payout.paypalBatchId) {
        logger.warn(`Payout ${payout._id} already released (idempotent)`, {
          payoutId: payout._id,
          batchId: payout.paypalBatchId,
        });
        results.processed++;
        continue;
      }

      seller.lastPayoutAttempt = new Date();
      await seller.save();

      let paypalPayout;
      try {
        paypalPayout = await createPayPalPayout(
          seller.paypalMerchantId,
          payoutAmount,
          'USD',
          { useMerchantId: true }
        );

        payout.status = 'released';
        payout.paypalBatchId = paypalPayout.batchId;
        payout.paypalItemId = paypalPayout.itemId;
        payout.paypalTransactionId = paypalPayout.batchId;
        payout.processedAt = new Date();
        await payout.save();

        logPayoutAttempt(seller._id, payoutAmount, 'success');
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
        const errorMessage = paypalError.message || '';
        logPayoutAttempt(seller._id, payoutAmount, 'failed', errorMessage);
        logger.error(`PayPal payout failed for payout ${payout._id}`, paypalError);

        if (errorMessage.includes('RECEIVER_UNREGISTERED') ||
            errorMessage.includes('INVALID_EMAIL') ||
            errorMessage.includes('RECEIVER_NOT_FOUND')) {
          const pa = await SellerPayoutAccount.findOne({ sellerId: seller._id });
          if (pa && pa.status === 'verified') {
            pa.status = 'pending';
            pa.notes = `Account validation failed during payout: ${errorMessage}`;
            await pa.save();
          }
          seller.paypalVerified = false;
          await seller.save();
          const adminUsers = await User.find({ roles: "admin", isActive: true });
          for (const admin of adminUsers) {
            await createNotification(
              admin._id,
              "payout",
              "Payout Account Validation Failed",
              `Seller ${seller.shopName} payout failed due to invalid PayPal account. Please review.`,
              { sellerId: seller._id, accountId: pa?._id, payoutId: payout._id },
              `/admin/sellers/${seller._id}/payout-account`
            );
          }
        }

        payout.status = 'failed';
        payout.notes = `PayPal payout failed: ${errorMessage}`;
        payout.failedReason = errorMessage;
        payout.processedAt = new Date();
        await payout.save();

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

        throw paypalError;
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

// Purpose: Calculates seller's payout balance including pending, available, and paid amounts
export const getSellerBalance = async (sellerId) => {
  const now = new Date();

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

  const pendingPayouts = await Payout.aggregate([
    {
      $match: {
        sellerId: new mongoose.Types.ObjectId(sellerId),
        status: 'pending',
        requestType: 'scheduled',
        $or: [
          { holdUntil: { $gt: now } },
          { holdUntil: null },
        ],
      },
    },
    {
      $group: {
        _id: null,
        totalPending: { $sum: '$netAmount' },
        totalCommission: { $sum: '$commissionAmount' },
        count: { $sum: 1 },
        earliestReleaseDate: { $min: '$holdUntil' },
      },
    },
  ]);

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

  const refundDeductions = await Payout.aggregate([
    {
      $match: {
        sellerId: new mongoose.Types.ObjectId(sellerId),
        requestType: 'scheduled',
        status: 'blocked',
        netAmount: { $lt: 0 },
      },
    },
    {
      $group: {
        _id: null,
        totalDeduction: { $sum: '$netAmount' },
        count: { $sum: 1 },
      },
    },
  ]);
  const deductionAmount = refundDeductions[0]?.totalDeduction || 0;

  const available = (availablePayouts[0]?.totalAvailable || 0) + deductionAmount;
  const pendingAmount = pendingPayouts[0]?.totalPending || 0;
  const earliestReleaseDate = pendingPayouts[0]?.earliestReleaseDate;

  let daysUntilAvailable = null;
  if (earliestReleaseDate) {
    const diffTime = earliestReleaseDate.getTime() - now.getTime();
    daysUntilAvailable = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  }

  const seller = await Seller.findById(sellerId).select('paypalVerified accountBlocked paypalOAuthConnected paypalMerchantId');
  const payoutEligible = isPayoutEligible(seller);
  let holdReason = null;
  if (!payoutEligible && (available > 0 || pendingAmount > 0)) {
    if (!seller?.paypalOAuthConnected) holdReason = 'Connect your PayPal account to withdraw.';
    else if (!seller?.paypalVerified) holdReason = 'Your PayPal account must be verified to receive payouts.';
    else if (seller?.accountBlocked) holdReason = 'Payouts are on hold. Contact support.';
    else holdReason = 'Payout is not available at this time.';
  }

  return {
    available,
    pending: {
      amount: pendingAmount,
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
    payoutEligible,
    holdReason,
  };
};

// Purpose: Retrieves seller's payout history with pagination
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

