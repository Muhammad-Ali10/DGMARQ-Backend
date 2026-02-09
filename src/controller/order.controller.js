import mongoose from "mongoose";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { logger } from "../utils/logger.js";
import { Order } from "../models/order.model.js";
import { Checkout } from "../models/checkout.model.js";
import { Cart } from "../models/cart.model.js";
import { LicenseKey } from "../models/licensekey.model.js";
import { Product } from "../models/product.model.js";
import { User } from "../models/user.model.js";
import { Payout } from "../models/payout.model.js";
import { capturePayPalPayment, getPayPalOrder } from "../services/payment.service.js";
import { assignKeyToOrder } from "../services/key.service.js";
import { sendLicenseKeyEmail, sendOrderConfirmation } from "../services/email.service.js";
import { queueEmail } from "../jobs/email.job.js";
import { logAction } from "../services/audit.service.js";
import { notifyOrderCreated } from "../services/notification.service.js";
import { schedulePayout } from "../services/payout.service.js";
import { applyCoupon } from "../services/coupon.service.js";
import { checkStockAfterAssignment } from "../services/stockNotification.service.js";
import { debitWallet } from "../services/wallet.service.js";
import { Transaction } from "../models/transaction.model.js";
import { calculateBuyerHandlingFee, assertValidHandlingFeeConfig } from "../services/handlingFee.service.js";
import { computeOrderRevenue, computeItemRevenue, logRevenueVerification } from "../services/orderRevenue.service.js";

// Purpose: Creates an order using wallet-only payment with MongoDB transaction
const createWalletOrder = async (checkoutId, userId, req) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  let retryCount = 0;
  const maxRetries = 2;

  while (retryCount <= maxRetries) {
    try {
      const existingOrder = await Order.findOne({ 
        checkoutId: checkoutId,
        paymentStatus: 'paid'
      }).session(session);
      
      if (existingOrder) {
        await session.abortTransaction();
        session.endSession();
        logger.warn('[WALLET ORDER] Order already exists (idempotent request)', {
          checkoutId,
          existingOrderId: existingOrder._id,
        });
        return existingOrder;
      }

      const checkout = await Checkout.findOneAndUpdate(
        { 
          _id: checkoutId,
          userId: userId,
          status: 'pending'
        },
        { 
          $set: { status: 'processing' }
        },
        { 
          session,
          new: true 
        }
      ).populate('items.productId', 'name price stock isFeatured featuredExtraCommission');

      if (!checkout) {
        await session.abortTransaction();
        session.endSession();
        throw new ApiError(404, 'Checkout session not found or already processed');
      }

      if (checkout.paymentMethod !== 'Wallet' || checkout.cardAmount > 0) {
        await Checkout.findByIdAndUpdate(checkoutId, { status: 'pending' }, { session });
        await session.abortTransaction();
        session.endSession();
        throw new ApiError(400, 'This checkout is not configured for wallet-only payment');
      }

      let recalculatedSubtotal = 0;
      for (const item of checkout.items) {
        const lineTotal = item.unitPrice * item.qty;
        recalculatedSubtotal += lineTotal;
      }

      const totalDiscount = (checkout.bundleDiscount || 0) + 
                           (checkout.subscriptionDiscount || 0) + 
                           (checkout.couponDiscount || 0);
      
      const productSubtotal = Math.round((recalculatedSubtotal - totalDiscount) * 100) / 100;

      await assertValidHandlingFeeConfig();
      const { buyerHandlingFee, grandTotal } = await calculateBuyerHandlingFee(productSubtotal);
      const handlingFee = Math.round(Number(buyerHandlingFee) * 100) / 100;
      if (handlingFee < 0) throw new ApiError(400, 'Invalid handling fee');

      const { getCommissionRate } = await import('../services/payout.service.js');
      const commissionRate = await getCommissionRate();
      const revenue = computeOrderRevenue(productSubtotal, handlingFee, commissionRate);

      const { getWalletBalance } = await import('../services/wallet.service.js');
      const walletBalance = await getWalletBalance(userId);

      if (walletBalance < revenue.totalPaid) {
        await Checkout.findByIdAndUpdate(checkoutId, { status: 'pending' }, { session });
        await session.abortTransaction();
        session.endSession();
        throw new ApiError(400, `Insufficient wallet balance. Available: $${walletBalance.toFixed(2)}, Required: $${revenue.totalPaid.toFixed(2)}`);
      }

      const walletResult = await debitWallet(
        userId,
        revenue.totalPaid,
        `Payment for checkout ${checkoutId}`,
        {
          checkoutId: checkout._id,
          orderType: 'purchase',
        },
        session // Use same session for transaction
      );

      const walletTransactionId = walletResult.transactionId;

      const orderItems = [];
      for (const checkoutItem of checkout.items) {
        const product = checkoutItem.productId;
        
        const assignedKeys = [];
        for (let i = 0; i < checkoutItem.qty; i++) {
          const key = await assignKeyToOrder(
            product._id,
            null,
            session
          );
          assignedKeys.push(key);
        }

        const finalUnitPrice = checkoutItem.unitPrice || checkoutItem.discountedPrice || product.price;
        const lineTotal = Math.round(finalUnitPrice * checkoutItem.qty * 100) / 100;
        const isFeaturedProduct = product?.isFeatured === true;
        const featuredExtraCommissionPercent = typeof product?.featuredExtraCommission === 'number'
          ? product.featuredExtraCommission
          : 10;
        const extraCommissionRate = isFeaturedProduct ? featuredExtraCommissionPercent : 0;
        const itemRev = computeItemRevenue(lineTotal, commissionRate, extraCommissionRate);

        let sellerId = checkoutItem.sellerId;
        if (sellerId && typeof sellerId === 'object' && sellerId._id) {
          sellerId = sellerId._id;
        }
        if (!sellerId || !mongoose.Types.ObjectId.isValid(sellerId)) {
          throw new ApiError(400, `Invalid seller ID for product: ${product?.name || 'Unknown'}`);
        }

        const productIdObjectId = product._id instanceof mongoose.Types.ObjectId 
          ? product._id 
          : new mongoose.Types.ObjectId(product._id);
        
        orderItems.push({
          productId: productIdObjectId,
          sellerId: new mongoose.Types.ObjectId(sellerId),
          qty: checkoutItem.qty,
          unitPrice: finalUnitPrice,
          lineTotal: itemRev.lineTotal,
          assignedKeyIds: assignedKeys.map(key => key._id),
          sellerEarning: itemRev.sellerEarning,
          commissionAmount: itemRev.commissionAmount,
          normalCommissionAmount: itemRev.normalCommissionAmount,
          featuredExtraCommissionAmount: itemRev.featuredExtraCommissionAmount,
          keyDeliveryStatus: 'pending',
        });
      }

      const generateOrderNumber = () => {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
        let orderNumber = '';
        for (let i = 0; i < 8; i++) {
          orderNumber += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return orderNumber;
      };

      let orderNumber;
      let attempts = 0;
      const maxAttempts = 10;
      do {
        orderNumber = generateOrderNumber();
        const existing = await Order.findOne({ orderNumber }).session(session);
        if (!existing) break;
        attempts++;
        if (attempts >= maxAttempts) {
          orderNumber = `ORD${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
          break;
        }
      } while (attempts < maxAttempts);

      const aggregateFromItems = () => {
        let totalLine = 0;
        let totalNormalCommission = 0;
        let totalFeaturedExtraCommission = 0;
        let totalSeller = 0;
        for (const item of orderItems) {
          const line = Number(item.lineTotal) || 0;
          const normalCommission = Number(item.normalCommissionAmount || 0);
          const featuredExtra = Number(item.featuredExtraCommissionAmount || 0);
          const sellerEarn = Number(item.sellerEarning || 0);
          totalLine += line;
          totalNormalCommission += normalCommission;
          totalFeaturedExtraCommission += featuredExtra;
          totalSeller += sellerEarn;
        }
        const totalCommission = Math.round((totalNormalCommission + totalFeaturedExtraCommission) * 100) / 100;
        const safeSeller = Math.max(0, Math.round(totalSeller * 100) / 100);
        const adminEarning = Math.round((totalCommission + revenue.handlingFee) * 100) / 100;
        return {
          totalLine,
          totalNormalCommission: Math.round(totalNormalCommission * 100) / 100,
          totalFeaturedExtraCommission: Math.round(totalFeaturedExtraCommission * 100) / 100,
          totalCommission,
          sellerEarning: safeSeller,
          adminEarning,
        };
      };

      const aggregated = aggregateFromItems();
      const finalRevenue = {
        ...revenue,
        commissionAmount: aggregated.totalCommission,
        sellerEarning: aggregated.sellerEarning,
        adminEarning: aggregated.adminEarning,
        normalCommissionAmount: aggregated.totalNormalCommission,
        featuredExtraCommissionAmount: aggregated.totalFeaturedExtraCommission,
      };

      logRevenueVerification(
        revenue.productSubtotal,
        revenue.handlingFee,
        finalRevenue.commissionAmount,
        finalRevenue.sellerEarning,
        finalRevenue.adminEarning,
        revenue.totalPaid
      );

      const createdOrderArray = await Order.create([{
        checkoutId: checkout._id,
        userId: checkout.userId,
        orderNumber: orderNumber,
        items: orderItems,
        currency: 'USD',
        subtotal: checkout.subtotal,
        discount: checkout.discount,
        totalAmount: productSubtotal,
        buyerHandlingFee: revenue.handlingFee,
        grandTotal: revenue.totalPaid,
        adminEarnings: finalRevenue.adminEarning,
        productSubtotal: revenue.productSubtotal,
        handlingFee: revenue.handlingFee,
        commissionRate: revenue.commissionRate,
        commissionAmount: finalRevenue.commissionAmount,
        normalCommissionAmount: finalRevenue.normalCommissionAmount,
        featuredExtraCommissionAmount: finalRevenue.featuredExtraCommissionAmount,
        sellerEarning: finalRevenue.sellerEarning,
        adminEarning: finalRevenue.adminEarning,
        totalPaid: revenue.totalPaid,
        paymentProvider: 'wallet',
        payoutStatus: 'pending',
        payoutAmount: finalRevenue.sellerEarning,
        couponId: checkout.couponId,
        paymentMethod: 'Wallet',
        paymentStatus: 'paid',
        paypalOrderId: null,
        paypalCaptureId: null,
        paypalPayerId: null,
        orderStatus: 'completed',
        orderCompletedAt: new Date(),
        payoutScheduledAt: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000),
      }], { session });
      
      const createdOrder = createdOrderArray[0];

      const allKeyIds = orderItems
        .filter(item => item.assignedKeyIds && item.assignedKeyIds.length > 0)
        .flatMap(item => item.assignedKeyIds);

      if (allKeyIds.length > 0) {
        const productIds = [...new Set(orderItems.map(item => item.productId.toString()))];
        
        for (const productId of productIds) {
          const itemKeyIds = orderItems
            .filter(item => item.productId.toString() === productId)
            .flatMap(item => item.assignedKeyIds || []);
          
          if (itemKeyIds.length > 0) {
            await LicenseKey.updateOne(
              { productId: new mongoose.Types.ObjectId(productId) },
              {
                $set: {
                  'keys.$[key].assignedToOrder': createdOrder._id,
                },
              },
              {
                arrayFilters: [{ 'key._id': { $in: itemKeyIds } }],
                session,
              }
            );
          }
        }
      }

      const sellerPayouts = new Map();
      for (const item of orderItems) {
        const sellerId = item.sellerId.toString();
        if (!sellerPayouts.has(sellerId)) {
          sellerPayouts.set(sellerId, {
            sellerId: item.sellerId,
            amount: 0,
            commission: 0,
            lineTotal: 0,
            extraFeaturedCommission: 0,
          });
        }
        const payout = sellerPayouts.get(sellerId);
        payout.amount += item.sellerEarning;
        payout.commission += item.commissionAmount;
        payout.lineTotal += item.lineTotal;
        payout.extraFeaturedCommission += item.featuredExtraCommissionAmount || 0;
      }

      for (const [sellerId, payoutData] of sellerPayouts) {
        const grossAmount = payoutData.lineTotal || (payoutData.amount + payoutData.commission);
        const baseCommissionFromGross = grossAmount * commissionRate;
        const extraFeaturedCommissionTotal = payoutData.extraFeaturedCommission || 0;
        const desiredTotalCommission = baseCommissionFromGross + extraFeaturedCommissionTotal;
        const effectiveCommissionRate = grossAmount > 0
          ? Math.min(1, Math.max(0, desiredTotalCommission / grossAmount))
          : commissionRate;
        await schedulePayout({
          orderId: createdOrder._id,
          sellerId: payoutData.sellerId,
          amount: grossAmount,
          orderCompletedAt: createdOrder.createdAt,
          commissionRateOverride: effectiveCommissionRate,
        }, session);
      }

      await Transaction.create([{
        userId: checkout.userId,
        orderId: createdOrder._id,
        type: 'payment',
        amount: revenue.totalPaid,
        currency: 'USD',
        status: 'completed',
        paymentMethod: 'Wallet',
        description: `Wallet payment for order ${createdOrder.orderNumber}`,
        metadata: {
          checkoutId: checkout._id,
          orderNumber: createdOrder.orderNumber,
          walletTransactionId: walletTransactionId.toString(), // Store actual ObjectId as string
        },
      }], { session });

      checkout.status = 'paid';
      checkout.walletAmount = revenue.totalPaid;
      checkout.cardAmount = 0;
      await checkout.save({ session });

      if (checkout.couponId) {
        await applyCoupon(checkout.couponId, createdOrder._id, checkout.userId);
      }

      await Cart.findOneAndUpdate(
        { userId: checkout.userId },
        { $set: { items: [] } },  
        { session }
      );

      await session.commitTransaction();
      session.endSession();

      try {
        const productIds = [...new Set(orderItems.map(item => item.productId.toString()))];
        for (const productId of productIds) {
          await checkStockAfterAssignment(productId);
        }
      } catch (stockError) {
        logger.error('[WALLET ORDER] Stock check failed (non-critical):', stockError);
      }

      try {
        const user = await User.findById(checkout.userId);
        if (user) {
          await queueEmail('order_confirmation', { orderId: createdOrder._id, userId: user._id });
          await queueEmail('license_key', { orderId: createdOrder._id, userId: user._id });
          await notifyOrderCreated(user._id, createdOrder);
        }
      } catch (emailError) {
        logger.error('[WALLET ORDER] Failed to queue emails (non-critical):', emailError);
      }

      try {
        await logAction(
          'order_created',
          checkout.userId,
          'Order',
          createdOrder._id,
          { totalAmount: createdOrder.totalAmount, itemsCount: createdOrder.items.length },
          req?.ip || req?.headers?.['x-forwarded-for'] || req?.socket?.remoteAddress || null,
          req?.headers?.['user-agent'] || null
        );
      } catch (auditError) {
        logger.error('[WALLET ORDER] Audit log failed (non-critical):', auditError);
      }

      logger.info('[WALLET ORDER] Order created successfully', {
        orderId: createdOrder._id,
        orderNumber: createdOrder.orderNumber,
        checkoutId: checkout._id,
        walletTransactionId: walletTransactionId.toString(),
        totalPaid: revenue.totalPaid,
      });

      return createdOrder;
    } catch (error) {
      const isTransientError = error.code === 112 ||
                               error.code === 251 ||
                               error.errorLabels?.includes('TransientTransactionError');

      if (isTransientError && retryCount < maxRetries) {
        retryCount++;
        logger.warn(`[WALLET ORDER] Transient error, retrying (${retryCount}/${maxRetries}):`, error.message);
        
        if (session.inTransaction()) {
          await session.abortTransaction();
        }
        
        await new Promise(resolve => setTimeout(resolve, 100 * retryCount));
        
        session.startTransaction();
        continue;
      }

      if (session.inTransaction()) {
        await session.abortTransaction();
      }
      
      try {
        const rollbackSession = await mongoose.startSession();
        rollbackSession.startTransaction();
        
        try {
          await Checkout.findOneAndUpdate(
            { _id: checkoutId, status: 'processing' }, // Only rollback if still processing
            { $set: { status: 'pending' } },
            { session: rollbackSession, new: true }
          );
          await rollbackSession.commitTransaction();
        } catch (rollbackError) {
          await rollbackSession.abortTransaction();
          logger.error('[WALLET ORDER] Failed to rollback checkout status:', rollbackError);
        } finally {
          rollbackSession.endSession();
        }
      } catch (rollbackSessionError) {
        logger.error('[WALLET ORDER] Failed to create rollback session:', rollbackSessionError);
      }
      
      session.endSession();

      logger.error('[WALLET ORDER] Order creation failed:', {
        checkoutId,
        userId: userId.toString(),
        error: error.message,
        code: error.code,
        retryCount,
      });
      throw error;
    }
  }
};

// Purpose: Creates an order with PayPal or mixed wallet/PayPal payment (supports guest checkout)
const createOrder = asyncHandler(async (req, res) => {
  const { checkoutId, paypalOrderId } = req.body;

  if (!checkoutId) {
    throw new ApiError(400, 'Checkout ID is required');
  }

  const checkout = await Checkout.findById(checkoutId)
    .populate('items.productId', 'name price stock isFeatured featuredExtraCommission');
  
  if (!checkout) {
    throw new ApiError(404, 'Checkout session not found');
  }

  if (checkout.status !== 'pending') {
    throw new ApiError(400, 'Checkout session already processed');
  }

  const isGuestCheckout = !!checkout.isGuest;
  if (isGuestCheckout) {
    if (req.user) {
      throw new ApiError(400, 'Guest checkout must not be used with an authenticated user');
    }
    if (!checkout.guestEmail || !checkout.guestEmail.trim()) {
      throw new ApiError(400, 'Guest checkout requires guestEmail');
    }
  } else {
    if (!req.user || !checkout.userId || checkout.userId.toString() !== req.user._id.toString()) {
      throw new ApiError(403, 'Checkout session does not belong to you');
    }
  }

  let paypalOrder = null;
  let capture = null;
  
  if (checkout.cardAmount > 0) {
    if (!paypalOrderId) {
      throw new ApiError(400, 'PayPal Order ID is required when card payment is needed');
    }

    try {
      paypalOrder = await getPayPalOrder(paypalOrderId);
      
      if (paypalOrder.status !== 'APPROVED' && paypalOrder.status !== 'COMPLETED') {
        throw new ApiError(400, `PayPal order not in valid state. Status: ${paypalOrder.status}`);
      }
    } catch (error) {
      throw new ApiError(400, `PayPal order verification failed: ${error.message}`);
    }

    if (paypalOrder.status === 'APPROVED') {
      try {
        capture = await capturePayPalPayment(paypalOrderId);
        
        if (capture.status !== 'COMPLETED') {
          throw new ApiError(400, 'Payment capture failed');
        }
      } catch (error) {
        throw new ApiError(400, `Payment capture failed: ${error.message}`);
      }
    } else {
      const captureData = paypalOrder.purchase_units?.[0]?.payments?.captures?.[0];
      if (!captureData) {
        throw new ApiError(400, 'Payment capture data not found in completed order');
      }
      
      capture = {
        id: captureData.id,
        status: captureData.status || 'COMPLETED',
        captureId: captureData.id,
        amount: captureData.amount?.value ? parseFloat(captureData.amount.value) : null,
        payerId: paypalOrder.payer?.payer_id || null,
      };
      
      logger.info('[ORDER] Using existing capture from completed order', {
        orderId: paypalOrderId,
        captureId: capture.captureId,
        status: capture.status,
      });
    }
  } else {
    logger.info('[ORDER] Full wallet payment - no PayPal order required', {
      checkoutId: checkout._id,
      walletAmount: checkout.walletAmount,
    });
  }

  const existingOrder = await Order.findOne({ paypalOrderId });
  if (existingOrder) {
    logger.warn('[ORDER] Order already exists (idempotent request)', {
      paypalOrderId,
      checkoutId,
      existingOrderId: existingOrder._id,
    });
    return res.status(200).json(
      new ApiResponse(200, existingOrder, 'Order already exists (idempotent request)')
    );
  }

  const session = await mongoose.startSession();
  session.startTransaction();

  let recalculatedSubtotal = 0;
  for (const item of checkout.items) {
    const lineTotal = item.unitPrice * item.qty;
    recalculatedSubtotal += lineTotal;
  }

  const totalDiscount = (checkout.bundleDiscount || 0) + 
                       (checkout.subscriptionDiscount || 0) + 
                       (checkout.couponDiscount || 0);
  
  const productSubtotal = Math.round((recalculatedSubtotal - totalDiscount) * 100) / 100;

  const { assertValidHandlingFeeConfig } = await import('../services/handlingFee.service.js');
  await assertValidHandlingFeeConfig();
  const { buyerHandlingFee, grandTotal } = await calculateBuyerHandlingFee(productSubtotal);
  const handlingFee = Math.round(Number(buyerHandlingFee) * 100) / 100;
  if (handlingFee < 0) throw new ApiError(400, 'Invalid handling fee');

  const { getCommissionRate } = await import('../services/payout.service.js');
  const commissionRate = await getCommissionRate();
  const revenue = computeOrderRevenue(productSubtotal, handlingFee, commissionRate);

  let recalculatedWalletAmount = 0;
  let recalculatedCardAmount = revenue.totalPaid;
  let walletBalance = 0;

  if (!isGuestCheckout && checkout.userId) {
    const { getWalletBalance } = await import('../services/wallet.service.js');
    walletBalance = await getWalletBalance(checkout.userId);
    if (walletBalance > 0) {
      if (walletBalance >= revenue.totalPaid) {
        recalculatedWalletAmount = revenue.totalPaid;
        recalculatedCardAmount = 0;
      } else {
        recalculatedWalletAmount = walletBalance;
        recalculatedCardAmount = revenue.totalPaid - walletBalance;
      }
    }
  }

  checkout.subtotal = recalculatedSubtotal;
  checkout.totalAmount = productSubtotal;
  checkout.walletAmount = recalculatedWalletAmount;
  checkout.cardAmount = recalculatedCardAmount;

  try {
    if (recalculatedWalletAmount > 0 && !isGuestCheckout && checkout.userId) {
      try {
        await debitWallet(
          checkout.userId,
          recalculatedWalletAmount,
          `Payment for checkout ${checkoutId}`,
          {
            checkoutId: checkout._id,
            orderType: 'purchase',
          },
          session
        );
        logger.info('[ORDER] Wallet debited successfully', {
          userId: checkout.userId,
          walletAmount: recalculatedWalletAmount,
          checkoutId: checkout._id,
          totalPaid: revenue.totalPaid,
        });
      } catch (walletError) {
        await session.abortTransaction();
        session.endSession();
        logger.error('[ORDER] Wallet debit failed', walletError);
        throw new ApiError(400, `Wallet payment failed: ${walletError.message}`);
      }
    }

    if (recalculatedCardAmount > 0 && capture) {
      const captureAmount = capture.amount || parseFloat(paypalOrder.purchase_units?.[0]?.amount?.value || 0);
      const tolerance = 0.01;
      if (Math.abs(captureAmount - recalculatedCardAmount) > tolerance) {
        logger.error('[ORDER] Payment amount mismatch', {
          checkoutId: checkout._id,
          expectedTotalPaid: revenue.totalPaid,
          recalculatedCardAmount,
          productSubtotal,
          walletBalance,
          captureAmount,
          items: checkout.items.map(item => ({
            name: item.name,
            qty: item.qty,
            unitPrice: item.unitPrice,
            lineTotal: item.unitPrice * item.qty,
          })),
        });
        
        await session.abortTransaction();
        session.endSession();
        throw new ApiError(400, `Payment amount mismatch. Expected: $${recalculatedCardAmount.toFixed(2)}, Received: $${captureAmount.toFixed(2)}. Please refresh and try again.`);
      }
      logger.info('[ORDER] Payment amount verified', {
        checkoutId: checkout._id,
        expectedCardAmount: recalculatedCardAmount.toFixed(2),
        captureAmount: captureAmount.toFixed(2),
        totalPaid: revenue.totalPaid,
      });
    }

    const orderItems = [];
    for (const checkoutItem of checkout.items) {
      const product = checkoutItem.productId;
      
      const assignedKeys = [];
      for (let i = 0; i < checkoutItem.qty; i++) {
        const key = await assignKeyToOrder(
          product._id,
          null,
          session
        );
        assignedKeys.push(key);
      }
      
      await checkStockAfterAssignment(product._id);

      const finalUnitPrice = checkoutItem.unitPrice || checkoutItem.discountedPrice || product.price;
      const lineTotal = Math.round(finalUnitPrice * checkoutItem.qty * 100) / 100;
      const isFeaturedProduct = product?.isFeatured === true;
      const featuredExtraCommissionPercent = typeof product?.featuredExtraCommission === 'number'
        ? product.featuredExtraCommission
        : 10;
      const extraCommissionRate = isFeaturedProduct ? featuredExtraCommissionPercent : 0;
      const itemRev = computeItemRevenue(lineTotal, commissionRate, extraCommissionRate);

      let sellerId = checkoutItem.sellerId;
      if (sellerId && typeof sellerId === 'object' && sellerId._id) {
        sellerId = sellerId._id;
      }
      if (!sellerId || !mongoose.Types.ObjectId.isValid(sellerId)) {
        logger.error(`Invalid sellerId in checkout item: ${checkoutItem.sellerId}`, {
          productId: product._id,
          productName: product.name,
        });
        throw new ApiError(400, `Invalid seller ID for product: ${product?.name || 'Unknown'}`);
      }

      const productIdObjectId = product._id instanceof mongoose.Types.ObjectId 
        ? product._id 
        : new mongoose.Types.ObjectId(product._id);
      
      orderItems.push({
        productId: productIdObjectId,
        sellerId: new mongoose.Types.ObjectId(sellerId),
        qty: checkoutItem.qty,
        unitPrice: finalUnitPrice,
        lineTotal: itemRev.lineTotal,
        assignedKeyIds: assignedKeys.map(key => key._id),
        sellerEarning: itemRev.sellerEarning,
        commissionAmount: itemRev.commissionAmount,
        normalCommissionAmount: itemRev.normalCommissionAmount,
        featuredExtraCommissionAmount: itemRev.featuredExtraCommissionAmount,
        keyDeliveryStatus: 'pending',
      });
    }

    const duplicateCheck = await Order.findOne({ 
      checkoutId: checkout._id,
      paymentStatus: 'paid'
    }).session(session);
    if (duplicateCheck) {
      await session.abortTransaction();
      session.endSession();
      logger.warn('[ORDER] Duplicate order detected during transaction', {
        checkoutId: checkout._id,
        existingOrderId: duplicateCheck._id,
      });
      return res.status(200).json(
        new ApiResponse(200, duplicateCheck, 'Order already exists (idempotent request)')
      );
    }

    const generateOrderNumber = () => {
      const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
      let orderNumber = '';
      for (let i = 0; i < 8; i++) {
        orderNumber += chars.charAt(Math.floor(Math.random() * chars.length));
      }
      return orderNumber;
    };

    let orderNumber;
    let attempts = 0;
    const maxAttempts = 10;
    do {
      orderNumber = generateOrderNumber();
      const existing = await Order.findOne({ orderNumber }).session(session);
      if (!existing) break;
      attempts++;
      if (attempts >= maxAttempts) {
        orderNumber = `ORD${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
        break;
      }
    } while (attempts < maxAttempts);

    const aggregateFromItems = () => {
      let totalLine = 0;
      let totalNormalCommission = 0;
      let totalFeaturedExtraCommission = 0;
      let totalSeller = 0;
      for (const item of orderItems) {
        const line = Number(item.lineTotal) || 0;
        const normalCommission = Number(item.normalCommissionAmount || 0);
        const featuredExtra = Number(item.featuredExtraCommissionAmount || 0);
        const sellerEarn = Number(item.sellerEarning || 0);
        totalLine += line;
        totalNormalCommission += normalCommission;
        totalFeaturedExtraCommission += featuredExtra;
        totalSeller += sellerEarn;
      }
      const totalCommission = Math.round((totalNormalCommission + totalFeaturedExtraCommission) * 100) / 100;
      const safeSeller = Math.max(0, Math.round(totalSeller * 100) / 100);
      const adminEarning = Math.round((totalCommission + revenue.handlingFee) * 100) / 100;
      return {
        totalLine,
        totalNormalCommission: Math.round(totalNormalCommission * 100) / 100,
        totalFeaturedExtraCommission: Math.round(totalFeaturedExtraCommission * 100) / 100,
        totalCommission,
        sellerEarning: safeSeller,
        adminEarning,
      };
    };

    const aggregated = aggregateFromItems();
    const finalRevenue = {
      ...revenue,
      commissionAmount: aggregated.totalCommission,
      sellerEarning: aggregated.sellerEarning,
      adminEarning: aggregated.adminEarning,
      normalCommissionAmount: aggregated.totalNormalCommission,
      featuredExtraCommissionAmount: aggregated.totalFeaturedExtraCommission,
    };

    logRevenueVerification(
      revenue.productSubtotal,
      revenue.handlingFee,
      finalRevenue.commissionAmount,
      finalRevenue.sellerEarning,
      finalRevenue.adminEarning,
      revenue.totalPaid
    );

    const paymentProviderValue = (recalculatedWalletAmount > 0 && recalculatedCardAmount > 0)
      ? 'card'
      : recalculatedCardAmount > 0
        ? 'paypal'
        : 'wallet';

    const createdOrderArray = await Order.create([{
      checkoutId: checkout._id,
      userId: isGuestCheckout ? null : checkout.userId,
      isGuest: isGuestCheckout,
      guestEmail: isGuestCheckout ? (checkout.guestEmail || '').trim().toLowerCase() : null,
      orderNumber: orderNumber,
      items: orderItems,
      currency: 'USD',
      subtotal: checkout.subtotal,
      discount: checkout.discount,
      totalAmount: productSubtotal,
      buyerHandlingFee: revenue.handlingFee,
      grandTotal: revenue.totalPaid,
      adminEarnings: finalRevenue.adminEarning,
      productSubtotal: revenue.productSubtotal,
      handlingFee: revenue.handlingFee,
      commissionRate: revenue.commissionRate,
      commissionAmount: finalRevenue.commissionAmount,
      normalCommissionAmount: finalRevenue.normalCommissionAmount,
      featuredExtraCommissionAmount: finalRevenue.featuredExtraCommissionAmount,
      sellerEarning: finalRevenue.sellerEarning,
      adminEarning: finalRevenue.adminEarning,
      totalPaid: revenue.totalPaid,
      paymentProvider: paymentProviderValue,
      payoutStatus: 'pending',
      payoutAmount: finalRevenue.sellerEarning,
      couponId: checkout.couponId,
      paymentMethod: checkout.paymentMethod || (checkout.walletAmount > 0 && checkout.cardAmount === 0 ? 'Wallet' : 'PayPal'),
      paymentStatus: 'paid',
      paypalOrderId: paypalOrderId || null,
      paypalCaptureId: capture?.captureId || null,
      paypalPayerId: capture?.payerId || paypalOrder?.payer?.payer_id || null,
      orderStatus: 'completed',
      orderCompletedAt: new Date(),
      payoutScheduledAt: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000),
    }], { session });
    
    const createdOrder = createdOrderArray[0];

    const allKeyIds = orderItems
      .filter(item => item.assignedKeyIds && item.assignedKeyIds.length > 0)
      .flatMap(item => item.assignedKeyIds);

    if (allKeyIds.length > 0) {
      const productIds = [...new Set(orderItems.map(item => item.productId.toString()))];
      
      for (const productId of productIds) {
        const itemKeyIds = orderItems
          .filter(item => item.productId.toString() === productId)
          .flatMap(item => item.assignedKeyIds || []);
        
        if (itemKeyIds.length > 0) {
          await LicenseKey.updateOne(
            { productId: new mongoose.Types.ObjectId(productId) },
            {
              $set: {
                'keys.$[key].assignedToOrder': createdOrder._id,
              },
            },
            {
              arrayFilters: [{ 'key._id': { $in: itemKeyIds } }],
              session,
            }
          );
        }
      }
    }

    const sellerPayouts = new Map();
    for (const item of orderItems) {
      const sellerId = item.sellerId.toString();
      if (!sellerPayouts.has(sellerId)) {
        sellerPayouts.set(sellerId, {
          sellerId: item.sellerId,
          amount: 0,
          commission: 0,
          lineTotal: 0,
          extraFeaturedCommission: 0,
        });
      }
      const payout = sellerPayouts.get(sellerId);
      payout.amount += item.sellerEarning;
      payout.commission += item.commissionAmount;
      payout.lineTotal += item.lineTotal;
      payout.extraFeaturedCommission += item.featuredExtraCommissionAmount || 0;
    }

    for (const [sellerId, payoutData] of sellerPayouts) {
      const grossAmount = payoutData.lineTotal || (payoutData.amount + payoutData.commission);
      const baseCommissionFromGross = grossAmount * commissionRate;
      const extraFeaturedCommissionTotal = payoutData.extraFeaturedCommission || 0;
      const desiredTotalCommission = baseCommissionFromGross + extraFeaturedCommissionTotal;
      const effectiveCommissionRate = grossAmount > 0
        ? Math.min(1, Math.max(0, desiredTotalCommission / grossAmount))
        : commissionRate;
      await schedulePayout({
        orderId: createdOrder._id,
        sellerId: payoutData.sellerId,
        amount: grossAmount,
        orderCompletedAt: createdOrder.createdAt,
        commissionRateOverride: effectiveCommissionRate,
      }, session);
    }

    if (!isGuestCheckout) {
      if (recalculatedWalletAmount > 0) {
        await Transaction.create([{
          userId: checkout.userId,
          orderId: createdOrder._id,
          type: 'payment',
          amount: recalculatedWalletAmount,
          currency: 'USD',
          status: 'completed',
          paymentMethod: 'Wallet',
          description: `Wallet payment for order ${createdOrder.orderNumber}`,
          metadata: {
            checkoutId: checkout._id,
            orderNumber: createdOrder.orderNumber,
          },
        }], { session });
      }

      if (recalculatedCardAmount > 0 && capture) {
        await Transaction.create([{
          userId: checkout.userId,
          orderId: createdOrder._id,
          type: 'payment',
          amount: recalculatedCardAmount,
          currency: 'USD',
          status: 'completed',
          paymentMethod: checkout.paymentMethod === 'Wallet+Card' ? 'Card' : (checkout.paymentMethod === 'Card' ? 'Card' : 'PayPal'),
          paypalOrderId: paypalOrderId || null,
          paypalCaptureId: capture.captureId || null,
          paypalTransactionId: capture.id || null,
          description: `${checkout.paymentMethod === 'Card' ? 'Card' : 'PayPal'} payment for order ${createdOrder.orderNumber}`,
          metadata: {
            checkoutId: checkout._id,
            orderNumber: createdOrder.orderNumber,
            payerId: capture.payerId || null,
          },
        }], { session });
      }
    }

    checkout.status = 'paid';
    await checkout.save({ session });

    if (checkout.couponId && !isGuestCheckout && checkout.userId) {
      await applyCoupon(checkout.couponId, createdOrder._id, checkout.userId);
    }

    if (!isGuestCheckout && checkout.userId) {
      await Cart.findOneAndUpdate(
        { userId: checkout.userId },
        { $set: { items: [] } },
        { session }
      );
    }

    await session.commitTransaction();

    if (!isGuestCheckout && checkout.userId) {
      const user = await User.findById(checkout.userId);
      if (user) {
        try {
          const { queueEmail } = await import("../jobs/email.job.js");
          await queueEmail('order_confirmation', { orderId: createdOrder._id, userId: user._id });
          await queueEmail('license_key', { orderId: createdOrder._id, userId: user._id });
          const { notifyOrderCreated } = await import("../services/notification.service.js");
          await notifyOrderCreated(user._id, createdOrder);
        } catch (emailError) {
          logger.error('Failed to queue emails', emailError);
        }
      }
      await logAction(
        'order_created',
        checkout.userId,
        'Order',
        createdOrder._id,
        { totalAmount: createdOrder.totalAmount, itemsCount: createdOrder.items.length },
        req.ip || req.headers?.['x-forwarded-for'] || req.socket?.remoteAddress || null,
        req.headers?.['user-agent'] || null
      );
    }

    if (isGuestCheckout) {
      try {
        const { queueEmail } = await import("../jobs/email.job.js");
        await queueEmail('license_key_guest', { orderId: createdOrder._id, guestEmail: checkout.guestEmail });
      } catch (emailError) {
        logger.error('Failed to queue guest license email', emailError);
      }
    }

    const populatedOrder = await Order.findById(createdOrder._id)
      .populate('items.productId', 'name images productType')
      .populate('items.sellerId', 'shopName')
      .populate('userId', 'name email')
      .lean();

    if (isGuestCheckout) {
      const { getDecryptedKey } = await import('../services/key.service.js');
      const licenseDetails = [];
      for (const item of populatedOrder.items) {
        const keyIds = item.assignedKeyIds || [];
        const keysForItem = [];
        for (const keyId of keyIds) {
          try {
            const decrypted = await getDecryptedKey(keyId);
            keysForItem.push(decrypted);
          } catch (e) {
            keysForItem.push('[Unavailable]');
          }
        }
        licenseDetails.push({
          productName: item.productId?.name || 'Product',
          productType: item.productId?.productType,
          keys: keysForItem,
        });
      }
      return res.status(201).json(
        new ApiResponse(201, { order: populatedOrder, licenseDetails }, 'Order created successfully')
      );
    }

    return res.status(201).json(
      new ApiResponse(201, populatedOrder, 'Order created successfully')
    );
  } catch (error) {
    if (session.inTransaction()) {
      await session.abortTransaction();
    }
    throw error;
  } finally {
    session.endSession();
  }
});

// Purpose: Retrieves orders with pagination for users or all orders for admins
const getOrders = asyncHandler(async (req, res) => {
  const userId = req.user._id;
  const userRoles = Array.isArray(req.user.roles) ? req.user.roles : (req.user.role ? [req.user.role] : []);
  const isAdmin = userRoles.some(role => role.toLowerCase() === 'admin');
  const { page = 1, limit = 10, status, paymentStatus } = req.query;

  const match = {};
  if (!isAdmin) {
    match.userId = new mongoose.Types.ObjectId(userId);
  }
  
  if (status) {
    match.orderStatus = status;
  }
  
  if (paymentStatus) {
    match.paymentStatus = paymentStatus;
  }

  const skip = (parseInt(page) - 1) * parseInt(limit);
  const limitNum = parseInt(limit);

  const orders = await Order.find(match)
    .populate('userId', 'name email')
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limitNum)
    .lean();

  const total = await Order.countDocuments(match);

  return res.status(200).json(
    new ApiResponse(200, {
      orders: orders,
      pagination: {
        page: parseInt(page),
        limit: limitNum,
        total: total,
        pages: Math.ceil(total / limitNum),
      },
    }, 'Orders retrieved successfully')
  );
});

// Purpose: Retrieves a specific order by ID with populated product and seller details
const getOrderById = asyncHandler(async (req, res) => {
  const { orderId } = req.params;
  const userId = req.user._id;

  if (!mongoose.Types.ObjectId.isValid(orderId)) {
    throw new ApiError(400, 'Invalid order ID');
  }

  const order = await Order.findOne({ _id: orderId })
    .populate('items.productId', 'name images description')
    .populate('items.sellerId', 'shopName shopLogo')
    .populate('items.assignedKeyIds', 'keyType')
    .populate('userId', 'name email profileImage');

  if (!order) {
    throw new ApiError(404, 'Order not found');
  }

  const userRoles = Array.isArray(req.user.roles) ? req.user.roles : (req.user.role ? [req.user.role] : []);
  const isAdmin = userRoles.some(r => r && r.toLowerCase() === 'admin');
  const isSeller = userRoles.some(r => r && r.toLowerCase() === 'seller');

  // Resolve order owner id: after populate, userId is an object with _id; otherwise it's an ObjectId
  const orderOwnerId = order.userId
    ? (order.userId._id ? order.userId._id.toString() : order.userId.toString())
    : null;

  if (order.isGuest || !orderOwnerId) {
    if (!isAdmin && !isSeller) {
      throw new ApiError(404, 'Order not found');
    }
    if (isSeller && !isAdmin) {
      const { Seller } = await import("../models/seller.model.js");
      const seller = await Seller.findOne({ userId });
      if (!seller) throw new ApiError(404, 'Order not found');
      const sellerObjectId = seller._id.toString();
      const hasSellerItems = order.items.some(item => item.sellerId && (item.sellerId._id ? item.sellerId._id.toString() : item.sellerId.toString()) === sellerObjectId);
      if (!hasSellerItems) throw new ApiError(404, 'Order not found');
    }
  } else {
    if (!isAdmin && !isSeller && orderOwnerId !== userId.toString()) {
      throw new ApiError(404, 'Order not found');
    }
  }

  if (isSeller && !isAdmin) {
    const orderObj = order.toObject ? order.toObject() : { ...order };
    delete orderObj.buyerHandlingFee;
    delete orderObj.grandTotal;
    delete orderObj.adminEarnings;
    delete orderObj.handlingFee;
    delete orderObj.adminEarning;
    delete orderObj.totalPaid;
    if (order.isGuest) {
      orderObj.guestEmail = order.guestEmail;
      orderObj.isGuest = true;
    }
    return res.status(200).json(
      new ApiResponse(200, orderObj, 'Order retrieved successfully')
    );
  }

  const responseOrder = order.toObject ? order.toObject() : order;
  if (order.isGuest) {
    responseOrder.guestEmail = order.guestEmail;
    responseOrder.isGuest = true;
  }
  return res.status(200).json(
    new ApiResponse(200, responseOrder, 'Order retrieved successfully')
  );
});

// Purpose: Retrieves decrypted license keys/credentials for an order. Supports logged-in (customer/seller/admin) and guest (orderId + guestEmail).
const getOrderKeys = asyncHandler(async (req, res) => {
  const { orderId } = req.params;
  const guestEmail = req.query.guestEmail ? String(req.query.guestEmail).trim().toLowerCase() : null;
  const user = req.user;

  if (!mongoose.Types.ObjectId.isValid(orderId)) {
    throw new ApiError(400, 'Invalid order ID');
  }

  let order = await Order.findOne({ _id: orderId })
    .populate('items.productId', 'name productType')
    .lean();

  if (!order) {
    throw new ApiError(404, 'Order not found');
  }

  // Guest access: no user, require guestEmail and order must be guest with matching email
  if (!user) {
    if (!guestEmail) {
      throw new ApiError(400, 'Guest email is required to view license keys for this order');
    }
    if (!order.isGuest || !order.guestEmail) {
      throw new ApiError(404, 'Order not found');
    }
    if (order.guestEmail.trim().toLowerCase() !== guestEmail) {
      throw new ApiError(404, 'Order not found');
    }
  } else {
    // Logged-in: must be customer (own order), admin, or seller (has items in order)
    const userRoles = Array.isArray(user.roles) ? user.roles : (user.role ? [user.role] : []);
    const isAdmin = userRoles.some((r) => r && r.toLowerCase() === 'admin');
    const isSeller = userRoles.some((r) => r && r.toLowerCase() === 'seller');
    const isCustomer = userRoles.some((r) => r && r.toLowerCase() === 'customer');

    const isOwner = order.userId && order.userId.toString() === user._id.toString();
    let sellerCanAccess = false;
    if (isSeller && !isAdmin) {
      const { Seller } = await import('../models/seller.model.js');
      const seller = await Seller.findOne({ userId: user._id }).lean();
      if (seller) {
        const sellerIdStr = seller._id.toString();
        sellerCanAccess = order.items.some(
          (item) => item.sellerId && (item.sellerId.toString?.() || item.sellerId._id?.toString?.()) === sellerIdStr
        );
      }
    }

    if (!isAdmin && !isOwner && !sellerCanAccess) {
      throw new ApiError(404, 'Order not found');
    }
  }

  // Only show keys when order is delivered/completed and payment is paid
  if (order.orderStatus !== 'completed' || order.paymentStatus !== 'paid') {
    return res.status(200).json(
      new ApiResponse(200, {
        orderId: order._id,
        licenseDetails: [],
        message: 'License not available yet.',
      }, 'Order keys retrieved successfully')
    );
  }

  const { getDecryptedKey } = await import('../services/key.service.js');
  const licenseDetails = [];

  for (const item of order.items) {
    const productName = item.productId?.name || 'Product';
    const productType = item.productId?.productType || 'LICENSE_KEY';

    if (item.refunded) {
      licenseDetails.push({
        productName,
        productType,
        keys: [],
        refunded: true,
      });
      continue;
    }

    const keyIds = item.assignedKeyIds || [];
    const keys = [];
    for (const keyId of keyIds) {
      try {
        const decrypted = await getDecryptedKey(keyId);
        keys.push(typeof decrypted === 'string' ? decrypted : JSON.stringify(decrypted));
      } catch (e) {
        keys.push('[Unavailable]');
      }
    }

    licenseDetails.push({
      productName,
      productType,
      keys,
      refunded: false,
    });
  }

  return res.status(200).json(
    new ApiResponse(200, {
      orderId: order._id,
      licenseDetails,
    }, 'Order keys retrieved successfully')
  );
});

// Purpose: Cancels an order and creates refund requests for all items
const cancelOrder = asyncHandler(async (req, res) => {
  const { orderId } = req.params;
  const userId = req.user._id;
  const { reason } = req.body;

  if (!mongoose.Types.ObjectId.isValid(orderId)) {
    throw new ApiError(400, 'Invalid order ID');
  }

  const order = await Order.findOne({
    _id: orderId,
    userId,
  });

  if (!order) {
    throw new ApiError(404, 'Order not found');
  }

  if (order.orderStatus === 'cancelled') {
    throw new ApiError(400, 'Order already cancelled');
  }

  if (order.paymentStatus !== 'paid') {
    throw new ApiError(400, 'Only paid orders can be cancelled');
  }

  const { ReturnRefund } = await import('../models/returnrefund.model.js');
  const existingRefund = await ReturnRefund.findOne({
    orderId: order._id,
    userId: userId,
    status: { $in: ['pending', 'approved', 'refunded', 'PENDING', 'SELLER_REVIEW', 'SELLER_APPROVED', 'ADMIN_REVIEW', 'ADMIN_APPROVED'] },
  });

  if (existingRefund) {
    throw new ApiError(400, 'A refund request already exists for this order');
  }

  const refundRequests = [];
  for (const item of order.items) {
    if (!item.refunded && item.sellerId) {
      const refund = await ReturnRefund.create({
        orderId: order._id,
        productId: item.productId,
        userId: userId,
        sellerId: item.sellerId,
        reason: reason || 'Order cancellation requested by buyer',
        status: 'pending',
        licenseKeyIds: [],
        refundHistory: [{ actor: 'customer', action: 'REFUND_REQUESTED', newStatus: 'pending', notes: 'Order cancellation', timestamp: new Date() }],
      });
      refundRequests.push(refund._id);
    }
  }

  if (refundRequests.length === 0) {
    throw new ApiError(400, 'All items in this order have already been refunded');
  }

  return res.status(200).json(
    new ApiResponse(200, {
      orderId: order._id,
      refundRequests: refundRequests,
      message: 'Refund requests created. Admin will process the refunds.',
    }, 'Order cancellation requested. Refund requests created.')
  );
});

// Purpose: Adds items from a previous order to the user's cart for reordering
const reorder = asyncHandler(async (req, res) => {
  const { orderId } = req.params;
  const userId = req.user._id;

  if (!mongoose.Types.ObjectId.isValid(orderId)) {
    throw new ApiError(400, "Invalid order ID");
  }

  const originalOrder = await Order.findOne({
    _id: orderId,
    userId,
  }).populate("items.productId");

  if (!originalOrder) {
    throw new ApiError(404, "Order not found");
  }

  let cart = await Cart.findOne({ userId });

  if (!cart) {
    cart = await Cart.create({ userId, items: [] });
  }

  for (const item of originalOrder.items) {
    const product = item.productId;

    if (!product) {
      continue;
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

    const existingItem = cart.items.find(
      (cartItem) => cartItem.productId.toString() === product._id.toString()
    );

    if (existingItem) {
      existingItem.qty += item.qty;
    } else {
      cart.items.push({
        productId: product._id,
        sellerId: item.sellerId,
        qty: item.qty,
        unitPrice: product.price,
      });
    }
  }

  await cart.save();

  return res.status(200).json(
    new ApiResponse(200, cart, "Items added to cart for reorder")
  );
});

// Purpose: Retrieves orders containing products sold by the authenticated seller
const getSellerOrders = asyncHandler(async (req, res) => {
  const userId = req.user._id;
  const { page = 1, limit = 10, status } = req.query;

  const { Seller } = await import("../models/seller.model.js");
  const seller = await Seller.findOne({ userId });
  
  if (!seller) {
    throw new ApiError(404, "Seller account not found");
  }

  const sellerObjectId = new mongoose.Types.ObjectId(seller._id);
  
  logger.debug('[SELLER ORDERS] Query params', {
    sellerId: seller._id,
    sellerObjectId: sellerObjectId.toString(),
    status,
    page,
    limit,
  });
  
  const match = {
    paymentStatus: "paid",
    items: {
      $elemMatch: {
        sellerId: sellerObjectId,
      },
    },
  };
  
  if (status) {
    match.orderStatus = status;
  }
  
  logger.debug('[SELLER ORDERS] Match query', JSON.stringify(match, null, 2));

  const orders = await Order.aggregate([
    { $match: match },
    { $sort: { createdAt: -1 } },
    {
      $lookup: {
        from: 'products',
        localField: 'items.productId',
        foreignField: '_id',
        as: 'products',
      },
    },
    {
      $lookup: {
        from: 'users',
        localField: 'userId',
        foreignField: '_id',
        as: 'buyer',
      },
    },
    {
      $unwind: {
        path: '$buyer',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $addFields: {
        items: {
          $filter: {
            input: '$items',
            as: 'item',
            cond: {
              $eq: [
                '$$item.sellerId',
                sellerObjectId
              ]
            }
          }
        }
      }
    },
    {
      $project: {
        _id: 1,
        items: 1,
        totalAmount: 1,
        orderStatus: 1,
        paymentStatus: 1,
        createdAt: 1,
        updatedAt: 1,
        isGuest: 1,
        guestEmail: 1,
        buyer: {
          $cond: {
            if: { $eq: ['$userId', null] },
            then: { name: 'Guest', email: '$guestEmail' },
            else: { name: '$buyer.name', email: '$buyer.email' },
          },
        },
        products: {
          $map: {
            input: '$products',
            as: 'product',
            in: {
              _id: '$$product._id',
              name: '$$product.name',
              images: '$$product.images',
            }
          }
        },
      },
    },
    {
      $match: {
        'items.0': { $exists: true }
      }
    },
  ]);

  logger.debug('[SELLER ORDERS] Found orders', { count: orders.length });

  const total = orders.length;
  const startIndex = (parseInt(page) - 1) * parseInt(limit);
  const endIndex = parseInt(page) * parseInt(limit);
  const paginatedOrders = orders.slice(startIndex, endIndex);

  return res.status(200).json(
    new ApiResponse(200, {
      orders: paginatedOrders,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: orders.length,
        pages: Math.ceil(orders.length / limit),
      },
    }, 'Seller orders retrieved successfully')
  );
});

export {
  createOrder,
  createWalletOrder, // Export wallet-only order creation (no PayPal SDK)
  getOrders,
  getOrderById,
  getOrderKeys,
  cancelOrder,
  reorder,
  getSellerOrders,
};

