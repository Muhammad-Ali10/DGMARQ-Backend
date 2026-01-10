import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { logger } from "../utils/logger.js";
import { createPayPalOrderForCheckout, capturePayPalOrderForCheckout } from "../services/payment.service.js";
import { Checkout } from "../models/checkout.model.js";
import mongoose from "mongoose";

/**
 * Create PayPal Order
 * POST /api/v1/paypal/orders
 * 
 * Body: { checkoutId } OR { amount, currency, items, discount?, tax_total?, shipping?, handling? }
 * 
 * SECURITY: 
 * - Prefer checkoutId: recalculates amount from DB (never trust client)
 * - If checkoutId not provided, accepts amount (legacy support, but not recommended)
 * - NO card data accepted
 */
const createOrder = asyncHandler(async (req, res) => {
  const { checkoutId, amount, currency, items, discount, tax_total, shipping, handling } = req.body;

  // FIX: Enhanced logging to debug missing checkoutId
  logger.debug('[PAYPAL ORDERS] Create order request received', {
    hasCheckoutId: !!checkoutId,
    checkoutId: checkoutId || 'MISSING',
    hasAmount: !!amount,
    hasItems: !!items,
    bodyKeys: Object.keys(req.body || {}),
  });

  // MANDATORY: If checkoutId provided, IGNORE ALL client financial fields
  // Recalculate everything from DB only
  if (checkoutId) {
    // SECURITY: Ignore all client-provided financial fields when checkoutId is present
    // This prevents client manipulation of amounts, items, discounts, etc.
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

    // SECURITY: Recalculate ALL financial data from DB - ignore ALL client fields
    // Client-provided amount, currency, items, discount, tax_total, shipping, handling are IGNORED
    const orderData = {
      currency: 'USD', // Hard-enforce USD (never trust client)
      items: checkout.items.map(item => ({
        name: item.name,
        quantity: item.qty,
        unit_amount: item.unitPrice, // From DB only
      })),
      discount: checkout.discount > 0 ? checkout.discount : undefined, // From DB only
      tax_total: undefined, // Not stored in checkout model
      shipping: undefined, // Not stored in checkout model
      handling: undefined, // Not stored in checkout model
    };
    
    // Log that client fields were ignored (for audit)
    if (amount || currency || items || discount || tax_total || shipping || handling) {
      logger.warn('[PAYPAL ORDERS] Client financial fields ignored (checkoutId provided)', {
        checkoutId,
        ignoredFields: { amount, currency, items: items?.length, discount, tax_total, shipping, handling },
      });
    }

    // Log for audit (NO sensitive data)
    logger.debug('[PAYPAL ORDERS] Create order from checkoutId', {
      checkoutId,
      totalAmount: checkout.totalAmount,
      itemCount: checkout.items.length,
      currency: 'USD',
    });

    try {
      const result = await createPayPalOrderForCheckout(orderData);

      // Update checkout with PayPal order ID
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

  // LEGACY: Accept amount from client (not recommended, but supported for backward compatibility)
  // Enhanced logging (NO sensitive data)
  logger.debug('[PAYPAL ORDERS] Create order request (legacy - amount from client)', {
    url: req.originalUrl,
    method: req.method,
    amount,
    currency,
    itemCount: items?.length || 0,
    hasDiscount: !!discount,
  });

    // Validation
    if (!amount || amount <= 0) {
      return res.status(400).json({
        ok: false,
        message: 'Amount is required and must be greater than 0',
        details: { field: 'amount', received: amount },
      });
    }

    // HARD-ENFORCE USD CURRENCY
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

    // Validate items structure
    for (const item of items) {
      if (!item.name || !item.quantity || item.unit_amount === undefined) {
        return res.status(400).json({
          ok: false,
          message: 'Each item must have name, quantity, and unit_amount',
          details: { invalidItem: { name: item.name, hasQuantity: !!item.quantity, hasUnitAmount: item.unit_amount !== undefined } },
        });
      }
    }

    // Prepare order data (USD enforced)
    const orderData = {
      amount: parseFloat(amount),
      currency: 'USD', // Hard-enforce USD
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

/**
 * Capture PayPal Order
 * POST /api/v1/paypal/orders/:orderId/capture
 * 
 * Body: { checkoutId } (optional, but recommended for order creation)
 * 
 * SECURITY: 
 * - Only validates orderId - NO card data
 * - If checkoutId provided, creates order in DB after successful capture
 */
const captureOrder = asyncHandler(async (req, res) => {
  const { orderId } = req.params;
  const { checkoutId } = req.body;

  // Enhanced logging (NO sensitive data)
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

    // MANDATORY: Verify captured amount + currency matches DB expected total
    if (checkoutId) {
      if (!mongoose.Types.ObjectId.isValid(checkoutId)) {
        return res.status(400).json({
          ok: false,
          message: 'Invalid checkout ID format',
          details: { field: 'checkoutId', received: checkoutId },
        });
      }

      // MANDATORY: Verify captured amount + currency matches DB expected total
      const checkout = await Checkout.findById(checkoutId);
      if (!checkout) {
        return res.status(404).json({
          ok: false,
          message: 'Checkout session not found',
          details: { checkoutId },
        });
      }

      // Verify captured amount matches DB expected total (USD, 2 decimals)
      const expectedAmount = parseFloat(checkout.totalAmount.toFixed(2));
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
        // Allow 1 cent tolerance for floating point issues
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

      // IDEMPOTENCY: Check if order already exists for this paypalOrderId
      const { Order } = await import('../models/order.model.js');
      const existingOrder = await Order.findOne({ paypalOrderId: orderId });
      
      if (existingOrder) {
        logger.warn('[PAYPAL ORDERS] Order already exists (idempotency)', {
          orderId,
          checkoutId,
          existingOrderId: existingOrder._id,
        });
        return res.status(200).json({
          ok: true,
          captureId: result.captureId,
          status: result.status,
          order: existingOrder,
          message: 'Order already exists (idempotent request)',
        });
      }

      // Import order controller function
      const { createOrder: createOrderInDB } = await import('./order.controller.js');
      
      // Create order in DB using existing order controller logic
      // This will handle: order creation, key assignment, payout scheduling, etc.
      try {
        // Note: createOrder expects { checkoutId, paypalOrderId } in body
        const orderReq = {
          body: { checkoutId, paypalOrderId: orderId },
          user: req.user,
        };
        const orderRes = {
          status: (code) => ({
            json: (data) => {
              if (code === 201) {
                return res.status(200).json({
                  ok: true,
                  captureId: result.captureId,
                  status: result.status,
                  order: data.data, // Order created in DB
                });
              }
              // If order creation fails, still return capture success
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

        // Call order creation (this handles the full order flow)
        await createOrderInDB(orderReq, orderRes);
        return; // Response already sent
      } catch (orderError) {
        // If order creation fails, still return capture success
        logger.error('[PAYPAL ORDERS] Order creation failed after capture', orderError);
        return res.status(200).json({
          ok: true,
          captureId: result.captureId,
          status: result.status,
          warning: 'Payment captured but order creation failed. Please contact support.',
        });
      }
    }

    // No checkoutId provided - just return capture result
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

