import mongoose from "mongoose";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { Checkout } from "../models/checkout.model.js";
import { getWalletBalance } from "../services/wallet.service.js";
import { logger } from "../utils/logger.js";

const processWalletPayment = asyncHandler(async (req, res) => {
  const { checkoutId } = req.params;
  const userId = req.user._id;

  if (!mongoose.Types.ObjectId.isValid(checkoutId)) {
    throw new ApiError(400, 'Invalid checkout ID');
  }

  const checkout = await Checkout.findById(checkoutId)
    .populate('items.productId', 'name price stock');
  
  if (!checkout) {
    throw new ApiError(404, 'Checkout session not found');
  }

  if (checkout.userId.toString() !== userId.toString()) {
    throw new ApiError(403, 'You do not have access to this checkout session');
  }

  if (checkout.status === 'paid') {
    const { Order } = await import('../models/order.model.js');
    const existingOrder = await Order.findOne({ 
      checkoutId: checkout._id,
      paymentStatus: 'paid'
    }).populate('items.productId', 'name images');

    if (existingOrder) {
      logger.info('[WALLET PAYMENT] Checkout already paid, returning existing order', {
        checkoutId,
        orderId: existingOrder._id,
      });
      return res.status(200).json(
        new ApiResponse(200, {
          order: existingOrder,
          paymentMethod: 'Wallet',
          walletAmount: checkout.walletAmount,
          walletBalance: await getWalletBalance(userId),
        }, 'Payment already processed. Order exists.')
      );
    }
  }

  if (checkout.status !== 'pending') {
    throw new ApiError(400, `Checkout session is ${checkout.status}. Only pending checkouts can be paid.`);
  }

  const amountToPay = checkout.grandTotal != null ? checkout.grandTotal : checkout.totalAmount;
  const walletBalance = await getWalletBalance(userId);

  if (walletBalance < amountToPay) {
    throw new ApiError(400, `Insufficient wallet balance. Your balance is $${walletBalance.toFixed(2)}, but the total is $${amountToPay.toFixed(2)}`);
  }

  if (checkout.paymentMethod !== 'Wallet' || checkout.walletAmount !== amountToPay || checkout.cardAmount > 0) {
    if (checkout.paymentMethod === 'Wallet') {
      throw new ApiError(400, 'Checkout configuration mismatch. Wallet amount must equal total for wallet-only payment');
    }
    checkout.paymentMethod = 'Wallet';
    checkout.walletAmount = amountToPay;
    checkout.cardAmount = 0;
    await checkout.save();
  }

  const { createWalletOrder } = await import('./order.controller.js');

  try {
    const createdOrder = await createWalletOrder(checkoutId, userId, req);

    const updatedWalletBalance = await getWalletBalance(userId);

    const { Order } = await import('../models/order.model.js');
    const populatedOrder = await Order.findById(createdOrder._id)
      .populate('items.productId', 'name images')
      .populate('items.sellerId', 'shopName')
      .populate('userId', 'name email')
      .lean();

    logger.info('[WALLET PAYMENT] Wallet payment processed successfully', {
      checkoutId,
      orderId: createdOrder._id,
      orderNumber: createdOrder.orderNumber,
      walletAmount: checkout.walletAmount,
      walletBalance: updatedWalletBalance,
    });

    return res.status(200).json(
      new ApiResponse(200, {
        order: populatedOrder,
        paymentMethod: 'Wallet',
        walletAmount: checkout.walletAmount,
        walletBalance: updatedWalletBalance,
      }, 'Wallet payment processed successfully. Order created.')
    );
  } catch (error) {
    logger.error('[WALLET PAYMENT] Error processing wallet payment:', {
      checkoutId,
      userId: userId.toString(),
      error: error.message,
      code: error.code,
      stack: error.stack,
    });

    if (error instanceof ApiError) {
      throw error;
    }

    if (error.code === 112 || error.errorLabels?.includes('TransientTransactionError')) {
      throw new ApiError(409, 'Payment processing conflict. Please try again.');
    }

    throw new ApiError(500, error.message || 'Wallet payment failed. Please try again.');
  }
});

export { processWalletPayment };
