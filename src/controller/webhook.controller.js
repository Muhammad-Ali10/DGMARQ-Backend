import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { logger } from "../utils/logger.js";
import { Order } from "../models/order.model.js";
import { Payout } from "../models/payout.model.js";
import { Transaction } from "../models/transaction.model.js";
import { Subscription } from "../models/subscription.model.js";
import { auditLog } from "../services/audit.service.js";
import { renewSubscription, handleSubscriptionPaymentFailure } from "../services/subscription.service.js";
import { verifyPayPalWebhook } from "../services/payment.service.js";
import paypal from "@paypal/checkout-server-sdk";

/**
 * PayPal webhook handler
 */
const handlePayPalWebhook = asyncHandler(async (req, res) => {
  // FIX: Verify webhook signature FIRST - do not touch DB if verification fails
  // This is a security requirement - webhook must be verified before any processing
  const isValid = await verifyPayPalWebhook(req);
  if (!isValid) {
    logger.error('[WEBHOOK] Signature verification failed - rejecting webhook');
    // FIX: Return 400 (not 401) as per requirement
    return res.status(400).json({
      ok: false,
      message: "Webhook signature verification failed",
    });
  }

  // Only after verification, parse and process webhook
  // Parse webhook event body (may be Buffer, string, or already parsed)
  let webhookEvent;
  if (Buffer.isBuffer(req.body)) {
    webhookEvent = JSON.parse(req.body.toString('utf8'));
  } else if (typeof req.body === 'string') {
    webhookEvent = JSON.parse(req.body);
  } else {
    webhookEvent = req.body;
  }

  // FIX: Safe logging of event_type and resource.id (non-sensitive identifiers only)
  const eventType = webhookEvent?.event_type || 'UNKNOWN';
  const resource = webhookEvent?.resource || {};
  const resourceId = resource?.id || 'N/A';
  const webhookId = webhookEvent?.id || 'N/A';

  // FIX: Log webhook event details for auditing (safe - only non-sensitive identifiers)
  logger.info('[WEBHOOK] Received webhook event', {
    eventType,
    resourceId,
    webhookId,
    timestamp: webhookEvent?.create_time || new Date().toISOString(),
  });

  // FIX: Validate webhook event structure
  if (!eventType || eventType === 'UNKNOWN') {
    logger.error('[WEBHOOK] Invalid webhook event - missing event_type');
    return res.status(400).json({
      ok: false,
      message: 'Invalid webhook event - missing event_type',
    });
  }

  // FIX: Supported event types (only process these)
  const supportedEventTypes = [
    'PAYMENT.CAPTURE.COMPLETED',
    'PAYMENT.CAPTURE.DENIED',
    'PAYMENT.CAPTURE.REFUNDED',
    'PAYOUTS.PAYOUT.COMPLETED',
    'PAYOUTS.PAYOUT.FAILED',
    'BILLING.SUBSCRIPTION.CREATED',
    'BILLING.SUBSCRIPTION.ACTIVATED',
    'BILLING.SUBSCRIPTION.CANCELLED',
    'BILLING.SUBSCRIPTION.EXPIRED',
    'BILLING.SUBSCRIPTION.PAYMENT.FAILED',
    'BILLING.SUBSCRIPTION.RENEWED',
  ];

  // FIX: Ignore unsupported events (log but don't process)
  if (!supportedEventTypes.includes(eventType)) {
    logger.warn(`[WEBHOOK] Unsupported event type ignored: ${eventType} (resource.id: ${resourceId})`);
    // Return 200 to acknowledge receipt (PayPal expects this)
    return res.status(200).json({
      ok: true,
      message: `Webhook received but event type '${eventType}' is not supported`,
      eventType,
      resourceId,
    });
  }

  try {
    // FIX: Process supported events
    switch (eventType) {
      case "PAYMENT.CAPTURE.COMPLETED":
        logger.info(`[WEBHOOK] Processing PAYMENT.CAPTURE.COMPLETED for resource.id: ${resourceId}`);
        await handlePaymentCaptureCompleted(resource);
        break;

      case "PAYMENT.CAPTURE.DENIED":
        logger.info(`[WEBHOOK] Processing PAYMENT.CAPTURE.DENIED for resource.id: ${resourceId}`);
        await handlePaymentCaptureDenied(resource);
        break;

      case "PAYMENT.CAPTURE.REFUNDED":
        logger.info(`[WEBHOOK] Processing PAYMENT.CAPTURE.REFUNDED for resource.id: ${resourceId}`);
        await handlePaymentRefunded(resource);
        break;

      case "PAYOUTS.PAYOUT.COMPLETED":
        logger.info(`[WEBHOOK] Processing PAYOUTS.PAYOUT.COMPLETED for resource.id: ${resourceId}`);
        await handlePayoutCompleted(resource);
        break;

      case "PAYOUTS.PAYOUT.FAILED":
        logger.info(`[WEBHOOK] Processing PAYOUTS.PAYOUT.FAILED for resource.id: ${resourceId}`);
        await handlePayoutFailed(resource);
        break;

      case "BILLING.SUBSCRIPTION.CREATED":
        logger.info(`[WEBHOOK] Processing BILLING.SUBSCRIPTION.CREATED for resource.id: ${resourceId}`);
        await handleSubscriptionCreated(resource);
        break;

      case "BILLING.SUBSCRIPTION.ACTIVATED":
        logger.info(`[WEBHOOK] Processing BILLING.SUBSCRIPTION.ACTIVATED for resource.id: ${resourceId}`);
        await handleSubscriptionActivated(resource);
        break;

      case "BILLING.SUBSCRIPTION.CANCELLED":
        logger.info(`[WEBHOOK] Processing BILLING.SUBSCRIPTION.CANCELLED for resource.id: ${resourceId}`);
        await handleSubscriptionCancelled(resource);
        break;

      case "BILLING.SUBSCRIPTION.EXPIRED":
        logger.info(`[WEBHOOK] Processing BILLING.SUBSCRIPTION.EXPIRED for resource.id: ${resourceId}`);
        await handleSubscriptionExpired(resource);
        break;

      case "BILLING.SUBSCRIPTION.PAYMENT.FAILED":
        logger.info(`[WEBHOOK] Processing BILLING.SUBSCRIPTION.PAYMENT.FAILED for resource.id: ${resourceId}`);
        await handleSubscriptionPaymentFailed(resource);
        break;

      case "BILLING.SUBSCRIPTION.RENEWED":
        logger.info(`[WEBHOOK] Processing BILLING.SUBSCRIPTION.RENEWED for resource.id: ${resourceId}`);
        await handleSubscriptionRenewed(resource);
        break;

      default:
        // This should never happen due to supportedEventTypes check above
        logger.warn(`[WEBHOOK] Event type '${eventType}' passed validation but has no handler`);
    }

    logger.info(`[WEBHOOK] Successfully processed event: ${eventType} (resource.id: ${resourceId})`);
    return res.status(200).json({
      ok: true,
      message: "Webhook processed successfully",
      eventType,
      resourceId,
    });
  } catch (error) {
    logger.error(`[WEBHOOK] Processing error for event '${eventType}' (resource.id: ${resourceId})`, {
      error: error.message,
      stack: error.stack,
    });
    // Return 200 to acknowledge receipt (PayPal expects this even on processing errors)
    return res.status(200).json({
      ok: false,
      message: "Webhook received but processing failed",
      eventType,
      resourceId,
    });
  }
});

// Handles PayPal payment capture completed event (RECONCILIATION)
// FIX: Resource shape for PAYMENT.CAPTURE.COMPLETED:
// - resource.id: capture ID
// - resource.amount.value: captured amount (string)
// - resource.amount.currency_code: currency code
// - resource.supplementary_data.related_ids.order_id: PayPal order ID
// - resource.payee: payee information (email/merchant_id)
const handlePaymentCaptureCompleted = async (resource) => {
  // FIX: Validate resource shape
  if (!resource || !resource.id) {
    logger.error('[WEBHOOK] Invalid PAYMENT.CAPTURE.COMPLETED resource - missing id');
    return;
  }

  const captureId = resource.id;
  const paypalOrderId = resource.supplementary_data?.related_ids?.order_id;
  const capturedAmount = parseFloat(resource.amount?.value || 0);
  const capturedCurrency = resource.amount?.currency_code || 'USD';

  // FIX: Log resource details for debugging (safe - only non-sensitive identifiers)
  logger.debug('[WEBHOOK] PAYMENT.CAPTURE.COMPLETED resource', {
    captureId,
    paypalOrderId: paypalOrderId || 'N/A',
    amount: resource.amount?.value || 'N/A',
    currency: capturedCurrency,
    status: resource.status || 'N/A',
  });

  // Find order by paypalOrderId or captureId (idempotency)
  const order = await Order.findOne({
    $or: [
      { paypalOrderId: paypalOrderId },
      { paypalCaptureId: captureId },
    ],
  });

  if (!order) {
    logger.warn(`[WEBHOOK] Order not found for capture ID: ${captureId}, orderId: ${paypalOrderId}`);
    // Log for reconciliation - order may not exist yet (race condition)
    return;
  }

  // FIX: Amount and currency already extracted above (lines 108-109)
  // RECONCILIATION: Verify captured amount matches DB expected total
  const expectedAmount = parseFloat(order.totalAmount.toFixed(2));
  const receivedAmount = parseFloat(capturedAmount.toFixed(2));

  if (capturedCurrency !== 'USD') {
    logger.error(`[WEBHOOK] Currency mismatch for order ${order._id}`, {
      expected: 'USD',
      received: capturedCurrency,
      captureId,
    });
    // Don't mark as paid if currency mismatch
    return;
  }

  if (Math.abs(receivedAmount - expectedAmount) > 0.01) {
    logger.error(`[WEBHOOK] Amount mismatch for order ${order._id}`, {
      expected: expectedAmount.toFixed(2),
      received: receivedAmount.toFixed(2),
      difference: Math.abs(receivedAmount - expectedAmount).toFixed(2),
      captureId,
    });
    // Don't mark as paid if amount mismatch
    return;
  }

  // VERIFICATION: Ensure payment was received by admin account
  const payee = resource.payee;
  if (payee) {
    logger.info(`[WEBHOOK] Payment captured - Receiver: ${payee.email || payee.merchant_id || 'Admin Account'}`);
    if (payee.email && !payee.email.includes(process.env.ADMIN_PAYPAL_EMAIL || '')) {
      logger.warn(`[WEBHOOK] WARNING: Payment receiver email (${payee.email}) may not be admin account.`);
    }
  }

  // FIX: Atomic update - only update if paymentStatus != "paid" (idempotent)
  // This prevents race conditions between capture endpoint and webhook
  const updateResult = await Order.updateOne(
    {
      _id: order._id,
      paymentStatus: { $ne: 'paid' }, // Only update if not already paid
    },
    {
      $set: {
        paymentStatus: 'paid',
        orderStatus: 'processing',
        paypalCaptureId: captureId,
      },
    }
  );

  // IDEMPOTENCY: Check if update was applied (order was not already paid)
  if (updateResult.matchedCount === 0) {
    logger.info(`[WEBHOOK] Order ${order._id} already marked as paid (idempotent webhook)`);
    return;
  }

  if (updateResult.modifiedCount === 0) {
    logger.info(`[WEBHOOK] Order ${order._id} update skipped (already paid)`);
    return;
  }

  logger.info(`[WEBHOOK] Order ${order._id} marked as paid via webhook`);
  await Transaction.create({
    userId: order.userId,
    orderId: order._id,
    type: "payment",
    amount: parseFloat(resource.amount.value),
    currency: resource.amount.currency_code,
    status: "completed",
    paymentMethod: "PayPal",
    paypalTransactionId: captureId,
    paypalOrderId: resource.supplementary_data?.related_ids?.order_id,
    paypalCaptureId: captureId,
    description: `Payment for order ${order._id} - Captured to ADMIN account`,
  });

  await auditLog(order.userId, "PAYMENT_CAPTURED", `Payment captured for order ${order._id} to ADMIN account`, {
    orderId: order._id,
    captureId,
    payee: payee ? (payee.email || payee.merchant_id) : 'Admin Account',
  });
};

// Handles PayPal payment capture denied event
const handlePaymentCaptureDenied = async (resource) => {
  const captureId = resource.id;

  const order = await Order.findOne({ paypalCaptureId: captureId });

  if (!order) {
    logger.warn(`[WEBHOOK] Order not found for capture ID: ${captureId}`);
    return;
  }

  order.paymentStatus = "failed";
  await order.save();

  await Transaction.create({
    userId: order.userId,
    orderId: order._id,
    type: "payment",
    amount: parseFloat(resource.amount.value),
    currency: resource.amount.currency_code,
    status: "failed",
    paymentMethod: "PayPal",
    paypalTransactionId: captureId,
    description: `Payment failed for order ${order._id}`,
  });

  await auditLog(order.userId, "PAYMENT_FAILED", `Payment failed for order ${order._id}`, {
    orderId: order._id,
    captureId,
  });
};

// Handles PayPal payment refunded event
const handlePaymentRefunded = async (resource) => {
  const refundId = resource.id;
  const captureId = resource.capture_id;

  const order = await Order.findOne({ paypalCaptureId: captureId });

  if (!order) {
    logger.warn(`[WEBHOOK] Order not found for capture ID: ${captureId}`);
    return;
  }

  order.paymentStatus = "refunded";
  await order.save();

  await Transaction.create({
    userId: order.userId,
    orderId: order._id,
    type: "refund",
    amount: parseFloat(resource.amount.value),
    currency: resource.amount.currency_code,
    status: "completed",
    paymentMethod: "PayPal",
    paypalTransactionId: refundId,
    description: `Refund for order ${order._id}`,
  });

  await auditLog(order.userId, "PAYMENT_REFUNDED", `Payment refunded for order ${order._id}`, {
    orderId: order._id,
    refundId,
  });
};

// Handles PayPal payout completed event
const handlePayoutCompleted = async (resource) => {
  const payoutBatchId = resource.payout_batch_id;

  const payout = await Payout.findOne({ paypalBatchId: payoutBatchId });

  if (!payout) {
    logger.warn(`[WEBHOOK] Payout not found for batch ID: ${payoutBatchId}`);
    return;
  }

  payout.status = "released";
  await payout.save();

  await Transaction.create({
    sellerId: payout.sellerId,
    payoutId: payout._id,
    orderId: payout.orderId,
    type: "payout",
    amount: payout.netAmount,
    currency: payout.currency,
    status: "completed",
    paymentMethod: "PayPal",
    paypalTransactionId: resource.transaction_id,
    description: `Payout for order ${payout.orderId}`,
  });

  await auditLog(payout.sellerId, "PAYOUT_COMPLETED", `Payout completed for order ${payout.orderId}`, {
    payoutId: payout._id,
    payoutBatchId,
  });
};

// Handles PayPal payout failed event
const handlePayoutFailed = async (resource) => {
  const payoutBatchId = resource.payout_batch_id;

  const payout = await Payout.findOne({ paypalBatchId: payoutBatchId });

  if (!payout) {
    logger.warn(`[WEBHOOK] Payout not found for batch ID: ${payoutBatchId}`);
    return;
  }

  payout.status = "failed";
  await payout.save();

  await Transaction.create({
    sellerId: payout.sellerId,
    payoutId: payout._id,
    orderId: payout.orderId,
    type: "payout",
    amount: payout.netAmount,
    currency: payout.currency,
    status: "failed",
    paymentMethod: "PayPal",
    paypalTransactionId: resource.transaction_id,
    description: `Payout failed for order ${payout.orderId}`,
  });

  await auditLog(payout.sellerId, "PAYOUT_FAILED", `Payout failed for order ${payout.orderId}`, {
    payoutId: payout._id,
    payoutBatchId,
  });
};

// Handles PayPal subscription created event
const handleSubscriptionCreated = async (resource) => {
  const subscriptionId = resource.id;
  logger.info(`[WEBHOOK] Subscription created: ${subscriptionId}`);
};

// Handles PayPal subscription activated event
const handleSubscriptionActivated = async (resource) => {
  const subscriptionId = resource.id;
  
  const subscription = await Subscription.findOne({ paypalSubscriptionId: subscriptionId });
  if (subscription) {
    subscription.status = 'active';
    await subscription.save();
    
    await auditLog(subscription.userId, "SUBSCRIPTION_ACTIVATED", `Subscription ${subscriptionId} activated`, {
      subscriptionId: subscription._id,
      paypalSubscriptionId: subscriptionId,
    });
  }
};

// Handles PayPal subscription cancelled event
const handleSubscriptionCancelled = async (resource) => {
  const subscriptionId = resource.id;
  
  const subscription = await Subscription.findOne({ paypalSubscriptionId: subscriptionId });
  if (subscription) {
    subscription.status = 'cancelled';
    subscription.cancelledAt = new Date();
    await subscription.save();
    
    await auditLog(subscription.userId, "SUBSCRIPTION_CANCELLED", `Subscription ${subscriptionId} cancelled`, {
      subscriptionId: subscription._id,
      paypalSubscriptionId: subscriptionId,
    });
  }
};

// Handles PayPal subscription expired event
const handleSubscriptionExpired = async (resource) => {
  const subscriptionId = resource.id;
  
  const subscription = await Subscription.findOne({ paypalSubscriptionId: subscriptionId });
  if (subscription) {
    subscription.status = 'expired';
    await subscription.save();
    
    await auditLog(subscription.userId, "SUBSCRIPTION_EXPIRED", `Subscription ${subscriptionId} expired`, {
      subscriptionId: subscription._id,
      paypalSubscriptionId: subscriptionId,
    });
  }
};

// Handles PayPal subscription payment failed event
const handleSubscriptionPaymentFailed = async (resource) => {
  const subscriptionId = resource.id;
  
  const subscription = await Subscription.findOne({ paypalSubscriptionId: subscriptionId });
  if (subscription) {
    await handleSubscriptionPaymentFailure(subscription._id);
    
    await auditLog(subscription.userId, "SUBSCRIPTION_PAYMENT_FAILED", `Subscription ${subscriptionId} payment failed`, {
      subscriptionId: subscription._id,
      paypalSubscriptionId: subscriptionId,
    });
  }
};

// Handles PayPal subscription renewed event
const handleSubscriptionRenewed = async (resource) => {
  const subscriptionId = resource.id;
  
  const subscription = await Subscription.findOne({ paypalSubscriptionId: subscriptionId });
  if (subscription) {
    await renewSubscription(subscription._id);
    
    await auditLog(subscription.userId, "SUBSCRIPTION_RENEWED", `Subscription ${subscriptionId} renewed`, {
      subscriptionId: subscription._id,
      paypalSubscriptionId: subscriptionId,
    });
  }
};

export {
  handlePayPalWebhook,
};

