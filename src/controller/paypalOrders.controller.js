import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { logger } from "../utils/logger.js";
import { createPayPalOrderForCheckout, capturePayPalOrderForCheckout } from "../services/payment.service.js";
import { Checkout } from "../models/checkout.model.js";
import { getWalletBalance } from "../services/wallet.service.js";
import { calculateBuyerHandlingFee } from "../services/handlingFee.service.js";
import mongoose from "mongoose";

// Purpose: Recalculates checkout amounts from items including buyer handling fee
const recalculateCheckoutAmounts = async (checkout) => {
  let subtotal = 0;
  for (const item of checkout.items) {
    const lineTotal = item.unitPrice * item.qty;
    item.lineTotal = lineTotal;
    subtotal += lineTotal;
  }

  const totalDiscount = (checkout.bundleDiscount || 0) +
    (checkout.subscriptionDiscount || 0) +
    (checkout.couponDiscount || 0);

  const totalAmount = Math.round((subtotal - totalDiscount) * 100) / 100;

  if (totalAmount <= 0) {
    throw new ApiError(400, 'Invalid total amount after recalculation');
  }

  const { buyerHandlingFee, grandTotal } = await calculateBuyerHandlingFee(totalAmount);
  const walletBalance = await getWalletBalance(checkout.userId);

  let walletAmount = 0;
  let cardAmount = grandTotal;
  let paymentMethod = "PayPal";

  if (walletBalance > 0) {
    if (walletBalance >= grandTotal) {
      walletAmount = grandTotal;
      cardAmount = 0;
      paymentMethod = "Wallet";
    } else {
      walletAmount = walletBalance;
      cardAmount = Math.round((grandTotal - walletBalance) * 100) / 100;
      paymentMethod = "Wallet+Card";
    }
  }

  checkout.subtotal = subtotal;
  checkout.totalAmount = totalAmount;
  checkout.buyerHandlingFee = buyerHandlingFee;
  checkout.grandTotal = grandTotal;
  checkout.walletAmount = walletAmount;
  checkout.cardAmount = cardAmount;
  checkout.paymentMethod = paymentMethod;

  logger.info('[PAYPAL ORDERS] Checkout amounts recalculated', {
    checkoutId: checkout._id,
    subtotal: subtotal.toFixed(2),
    totalAmount: totalAmount.toFixed(2),
    buyerHandlingFee,
    grandTotal: grandTotal.toFixed(2),
    walletAmount: walletAmount.toFixed(2),
    cardAmount: cardAmount.toFixed(2),
    paymentMethod,
    itemCount: checkout.items.length,
  });

  return checkout;
};

// Purpose: Creates a PayPal order from checkout or direct amount with security validation
const createOrder = asyncHandler(async (req, res) => {
  const { checkoutId, amount, currency, items, discount, tax_total, shipping, handling } = req.body;

  logger.debug('[PAYPAL ORDERS] Create order request received', {
    hasCheckoutId: !!checkoutId,
    checkoutId: checkoutId || 'MISSING',
    hasAmount: !!amount,
    hasItems: !!items,
    bodyKeys: Object.keys(req.body || {}),
  });

  if (checkoutId) {
    if (!mongoose.Types.ObjectId.isValid(checkoutId)) {
      return res.status(400).json({
        ok: false,
        message: 'Invalid checkout ID format',
        details: { field: 'checkoutId', received: checkoutId },
      });
    }

    const checkout = await Checkout.findById(checkoutId).populate('items.productId');
    
    if (!checkout) {
      return res.status(404).json({
        ok: false,
        message: 'Checkout session not found',
        details: { checkoutId },
      });
    }

    if (checkout.status !== 'pending') {
      return res.status(400).json({
        ok: false,
        message: 'Checkout session already processed',
        details: { checkoutId, status: checkout.status },
      });
    }

    if (checkout.isGuest) {
      if (req.user) {
        return res.status(400).json({
          ok: false,
          message: 'This is a guest checkout; do not send auth token',
          details: { checkoutId },
        });
      }
    } else {
      if (!req.user || !checkout.userId || checkout.userId.toString() !== req.user._id.toString()) {
        return res.status(403).json({
          ok: false,
          message: 'Checkout session does not belong to you',
          details: { checkoutId },
        });
      }
    }

    if (!checkout.isGuest) {
      await recalculateCheckoutAmounts(checkout);
      await checkout.save();
    }

    const totalDiscount = (checkout.bundleDiscount || 0) +
      (checkout.subscriptionDiscount || 0) +
      (checkout.couponDiscount || 0);

    // When wallet is used, charge only cardAmount on PayPal so capture amount matches expected
    const grandTotal = checkout.grandTotal ?? checkout.totalAmount;
    const cardAmount = checkout.cardAmount;
    const useExplicitAmount = cardAmount != null && grandTotal != null && cardAmount < grandTotal;
    const orderData = {
      currency: 'USD',
      ...(useExplicitAmount ? { amount: cardAmount } : {}),
      items: checkout.items.map(item => ({
        name: item.name,
        quantity: item.qty,
        unit_amount: item.unitPrice,
      })),
      discount: totalDiscount > 0 ? totalDiscount : 0,
      tax_total: 0,
      shipping: 0,
      handling: checkout.buyerHandlingFee || 0,
    };
    
    if (amount || currency || items || discount || tax_total || shipping || handling) {
      logger.warn('[PAYPAL ORDERS] Client financial fields ignored (checkoutId provided)', {
        checkoutId,
        ignoredFields: { amount, currency, items: items?.length, discount, tax_total, shipping, handling },
      });
    }

    logger.debug('[PAYPAL ORDERS] Create order from checkoutId', {
      checkoutId,
      totalAmount: checkout.totalAmount,
      cardAmount: checkout.cardAmount,
      walletAmount: checkout.walletAmount,
      itemCount: checkout.items.length,
      currency: 'USD',
    });

    try {
      const result = await createPayPalOrderForCheckout(orderData);

      checkout.paypalOrderId = result.orderId;
      await checkout.save();

      return res.status(201).json({
        ok: true,
        orderId: result.orderId,
        status: result.status,
        checkoutId: checkout._id,
      });
    } catch (error) {
      logger.error('[PAYPAL ORDERS] Create order error', {
        error: error.message,
        checkoutId,
      });
      return res.status(500).json({
        ok: false,
        message: `Failed to create PayPal order: ${error.message}`,
      });
    }
  }

  logger.debug('[PAYPAL ORDERS] Create order request (legacy - amount from client)', {
    url: req.originalUrl,
    method: req.method,
    amount,
    currency,
    itemCount: items?.length || 0,
    hasDiscount: !!discount,
  });

    if (!amount || amount <= 0) {
      return res.status(400).json({
        ok: false,
        message: 'Amount is required and must be greater than 0',
        details: { field: 'amount', received: amount },
      });
    }

    if (currency && currency !== 'USD') {
      return res.status(400).json({
        ok: false,
        message: 'Currency must be USD',
        details: { field: 'currency', received: currency, required: 'USD' },
      });
    }

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        ok: false,
        message: 'Items array is required and must not be empty',
        details: { field: 'items', received: items },
      });
    }

    for (const item of items) {
      if (!item.name || !item.quantity || item.unit_amount === undefined) {
        return res.status(400).json({
          ok: false,
          message: 'Each item must have name, quantity, and unit_amount',
          details: { invalidItem: { name: item.name, hasQuantity: !!item.quantity, hasUnitAmount: item.unit_amount !== undefined } },
        });
      }
    }

    const orderData = {
      amount: parseFloat(amount),
      currency: 'USD',
      items: items.map(item => ({
        name: item.name,
        quantity: typeof item.quantity === 'number' ? item.quantity : parseFloat(item.quantity),
        unit_amount: typeof item.unit_amount === 'number' ? item.unit_amount : parseFloat(item.unit_amount),
      })),
      discount: discount ? parseFloat(discount) : undefined,
      tax_total: tax_total ? parseFloat(tax_total) : undefined,
      shipping: shipping ? parseFloat(shipping) : undefined,
      handling: handling ? parseFloat(handling) : undefined,
    };

    try {
      const result = await createPayPalOrderForCheckout(orderData);

      return res.status(201).json({
        ok: true,
        orderId: result.orderId,
        status: result.status,
      });
    } catch (error) {
      logger.error('[PAYPAL ORDERS] Create order error', {
        error: error.message,
        stack: error.stack,
      });
      return res.status(500).json({
        ok: false,
        message: `Failed to create PayPal order: ${error.message}`,
      });
    }
});

// Purpose: Captures a PayPal order and creates DB order if checkout ID provided
const captureOrder = asyncHandler(async (req, res) => {
  const { orderId } = req.params;
  const { checkoutId } = req.body;

  logger.debug('[PAYPAL ORDERS] Capture order request', {
    url: req.originalUrl,
    method: req.method,
    orderId,
    hasCheckoutId: !!checkoutId,
  });

  if (!orderId) {
    return res.status(400).json({
      ok: false,
      message: 'Order ID is required in URL',
      details: { field: 'orderId', location: 'URL params' },
    });
  }

  try {
    const result = await capturePayPalOrderForCheckout(orderId);

    if (checkoutId) {
      if (!mongoose.Types.ObjectId.isValid(checkoutId)) {
        return res.status(400).json({
          ok: false,
          message: 'Invalid checkout ID format',
          details: { field: 'checkoutId', received: checkoutId },
        });
      }

      const checkout = await Checkout.findById(checkoutId);
      if (!checkout) {
        return res.status(404).json({
          ok: false,
          message: 'Checkout session not found',
          details: { checkoutId },
        });
      }

      if (checkout.isGuest) {
        if (req.user) {
          return res.status(400).json({
            ok: false,
            message: 'This is a guest checkout; do not send auth token',
            details: { checkoutId },
          });
        }
      } else {
        if (!req.user || !checkout.userId || checkout.userId.toString() !== req.user._id.toString()) {
          return res.status(403).json({
            ok: false,
            message: 'Checkout session does not belong to you',
            details: { checkoutId },
          });
        }
      }

      const expectedAmount = parseFloat((checkout.cardAmount ?? checkout.grandTotal ?? checkout.totalAmount).toFixed(2));
      const capturedAmount = result.amount ? parseFloat(result.amount.toFixed(2)) : null;
      const capturedCurrency = result.currency || 'USD';

      if (capturedAmount === null) {
        logger.error('[PAYPAL ORDERS] Capture amount missing in response', {
          orderId,
          checkoutId,
          captureData: result.fullCaptureData,
        });
        return res.status(500).json({
          ok: false,
          message: 'Capture amount verification failed: amount missing in PayPal response',
        });
      }

      if (capturedCurrency !== 'USD') {
        logger.error('[PAYPAL ORDERS] Capture currency mismatch', {
          orderId,
          checkoutId,
          expected: 'USD',
          received: capturedCurrency,
        });
        return res.status(400).json({
          ok: false,
          message: 'Capture currency mismatch',
          details: {
            expected: 'USD',
            received: capturedCurrency,
          },
        });
      }

      if (Math.abs(capturedAmount - expectedAmount) > 0.01) {
        logger.error('[PAYPAL ORDERS] Capture amount mismatch', {
          orderId,
          checkoutId,
          expectedAmount,
          capturedAmount,
          difference: Math.abs(capturedAmount - expectedAmount),
        });
        return res.status(400).json({
          ok: false,
          message: 'Capture amount does not match expected total. Payment not marked as paid.',
          details: {
            expected: expectedAmount.toFixed(2),
            captured: capturedAmount.toFixed(2),
            difference: Math.abs(capturedAmount - expectedAmount).toFixed(2),
            currency: 'USD',
          },
        });
      }

      logger.info('[PAYPAL ORDERS] Capture amount verified', {
        orderId,
        checkoutId,
        amount: capturedAmount.toFixed(2),
        currency: capturedCurrency,
      });

      const { Order } = await import('../models/order.model.js');
      const existingOrder = await Order.findOne({ paypalOrderId: orderId });
      
      if (existingOrder) {
        logger.warn('[PAYPAL ORDERS] Order already exists (idempotency)', {
          orderId,
          checkoutId,
          existingOrderId: existingOrder._id,
        });
        const responsePayload = {
          ok: true,
          captureId: result.captureId,
          status: result.status,
          order: existingOrder,
          message: 'Order already exists (idempotent request)',
        };
        if (existingOrder.isGuest) {
          responsePayload.guestOrder = true;
          responsePayload.guestEmail = existingOrder.guestEmail;
        }
        return res.status(200).json(responsePayload);
      }

      const { createOrder: createOrderInDB } = await import('./order.controller.js');
      
      try {
        const orderReq = {
          body: { checkoutId, paypalOrderId: orderId },
          user: req.user,
        };
        const orderRes = {
          status: (code) => ({
            json: (data) => {
              if (code === 201) {
                const responseData = data.data || data;
                const payload = {
                  ok: true,
                  captureId: result.captureId,
                  status: result.status,
                  order: responseData.order || responseData,
                };
                if (responseData.licenseDetails) {
                  payload.licenseDetails = responseData.licenseDetails;
                  payload.guestOrder = true;
                }
                return res.status(200).json(payload);
              }
              logger.error('[PAYPAL ORDERS] Order creation failed after capture', data);
              return res.status(200).json({
                ok: true,
                captureId: result.captureId,
                status: result.status,
                warning: 'Payment captured but order creation failed. Please contact support.',
              });
            },
          }),
        };

        await createOrderInDB(orderReq, orderRes);
        return;
      } catch (orderError) {
        logger.error('[PAYPAL ORDERS] Order creation failed after capture', orderError);
        return res.status(200).json({
          ok: true,
          captureId: result.captureId,
          status: result.status,
          warning: 'Payment captured but order creation failed. Please contact support.',
        });
      }
    }

    return res.status(200).json({
      ok: true,
      captureId: result.captureId,
      status: result.status,
    });
  } catch (error) {
    logger.error('[PAYPAL ORDERS] Capture order error', {
      error: error.message,
      stack: error.stack,
      orderId,
    });
    return res.status(500).json({
      ok: false,
      message: `Failed to capture PayPal order: ${error.message}`,
    });
  }
});

export {
  createOrder,
  captureOrder,
};

