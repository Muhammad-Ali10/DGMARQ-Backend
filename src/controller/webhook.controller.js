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
import { blockPayoutsForOrder } from "../services/payout.service.js";
import paypal from "@paypal/checkout-server-sdk";

/** Handles PayPal webhooks: verifies signature, dispatches by event type. Returns 200 for audit. */
const handlePayPalWebhook = asyncHandler(async (req, res) => {
  const isValid = await verifyPayPalWebhook(req);
  if (!isValid) {
    logger.error('[WEBHOOK] Signature verification failed - rejecting webhook');
    return res.status(400).json({
      ok: false,
      message: "Webhook signature verification failed",
    });
  }

  let webhookEvent;
  if (Buffer.isBuffer(req.body)) {
    webhookEvent = JSON.parse(req.body.toString('utf8'));
  } else if (typeof req.body === 'string') {
    webhookEvent = JSON.parse(req.body);
  } else {
    webhookEvent = req.body;
  }

  const eventType = webhookEvent?.event_type || 'UNKNOWN';
  const resource = webhookEvent?.resource || {};
  const resourceId = resource?.id || 'N/A';
  const webhookId = webhookEvent?.id || 'N/A';

  logger.info('[WEBHOOK] Received webhook event', {
    eventType,
    resourceId,
    webhookId,
    timestamp: webhookEvent?.create_time || new Date().toISOString(),
  });

  if (!eventType || eventType === 'UNKNOWN') {
    logger.error('[WEBHOOK] Invalid webhook event - missing event_type');
    return res.status(400).json({
      ok: false,
      message: 'Invalid webhook event - missing event_type',
    });
  }

  const supportedEventTypes = [
    'PAYMENT.CAPTURE.COMPLETED',
    'PAYMENT.CAPTURE.DENIED',
    'PAYMENT.CAPTURE.REFUNDED',
    'CHECKOUT.ORDER.APPROVED',
    'CUSTOMER.DISPUTE.CREATED',
    'PAYOUTS.PAYOUT.COMPLETED',
    'PAYOUTS.PAYOUT.FAILED',
    'PAYOUTS-ITEM.SUCCEEDED',
    'PAYOUTS-ITEM.FAILED',
    'BILLING.SUBSCRIPTION.CREATED',
    'BILLING.SUBSCRIPTION.ACTIVATED',
    'BILLING.SUBSCRIPTION.CANCELLED',
    'BILLING.SUBSCRIPTION.EXPIRED',
    'BILLING.SUBSCRIPTION.PAYMENT.FAILED',
    'BILLING.SUBSCRIPTION.RENEWED',
  ];

  if (!supportedEventTypes.includes(eventType)) {
    logger.warn(`[WEBHOOK] Unsupported event type ignored: ${eventType} (resource.id: ${resourceId})`);
    return res.status(200).json({
      ok: true,
      message: `Webhook received but event type '${eventType}' is not supported`,
      eventType,
      resourceId,
    });
  }

  try {
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

      case "CHECKOUT.ORDER.APPROVED":
        logger.info(`[WEBHOOK] Processing CHECKOUT.ORDER.APPROVED for resource.id: ${resourceId}`);
        await handleCheckoutOrderApproved(resource);
        break;

      case "CUSTOMER.DISPUTE.CREATED":
        logger.info(`[WEBHOOK] Processing CUSTOMER.DISPUTE.CREATED for resource.id: ${resourceId}`);
        await handleCustomerDisputeCreated(resource);
        break;

      case "PAYOUTS.PAYOUT.COMPLETED":
        logger.info(`[WEBHOOK] Processing PAYOUTS.PAYOUT.COMPLETED for resource.id: ${resourceId}`);
        await handlePayoutCompleted(resource);
        break;

      case "PAYOUTS.PAYOUT.FAILED":
        logger.info(`[WEBHOOK] Processing PAYOUTS.PAYOUT.FAILED for resource.id: ${resourceId}`);
        await handlePayoutFailed(resource);
        break;

      case "PAYOUTS-ITEM.SUCCEEDED":
        logger.info(`[WEBHOOK] Processing PAYOUTS-ITEM.SUCCEEDED for resource.id: ${resourceId}`);
        await handlePayoutItemSucceeded(resource);
        break;

      case "PAYOUTS-ITEM.FAILED":
        logger.info(`[WEBHOOK] Processing PAYOUTS-ITEM.FAILED for resource.id: ${resourceId}`);
        await handlePayoutItemFailed(resource);
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
    return res.status(200).json({
      ok: false,
      message: "Webhook received but processing failed",
      eventType,
      resourceId,
    });
  }
});

const handlePaymentCaptureCompleted = async (resource) => {
  if (!resource || !resource.id) {
    logger.error('[WEBHOOK] Invalid PAYMENT.CAPTURE.COMPLETED resource - missing id');
    return;
  }

  const captureId = resource.id;
  const paypalOrderId = resource.supplementary_data?.related_ids?.order_id;
  const capturedAmount = parseFloat(resource.amount?.value || 0);
  const capturedCurrency = resource.amount?.currency_code || 'USD';

  const order = await Order.findOne({
    $or: [
      { paypalOrderId: paypalOrderId },
      { paypalCaptureId: captureId },
    ],
  });

  if (!order) {
    logger.warn(`[WEBHOOK] Order not found for capture ID: ${captureId}, orderId: ${paypalOrderId}`);
    return;
  }

  const expectedAmount = parseFloat(order.totalAmount.toFixed(2));
  const receivedAmount = parseFloat(capturedAmount.toFixed(2));

  if (capturedCurrency !== 'USD') {
    logger.error(`[WEBHOOK] Currency mismatch for order ${order._id}`, {
      expected: 'USD',
      received: capturedCurrency,
      captureId,
    });
    return;
  }

  if (Math.abs(receivedAmount - expectedAmount) > 0.01) {
    logger.error(`[WEBHOOK] Amount mismatch for order ${order._id}`, {
      expected: expectedAmount.toFixed(2),
      received: receivedAmount.toFixed(2),
      difference: Math.abs(receivedAmount - expectedAmount).toFixed(2),
      captureId,
    });
    return;
  }

  const payee = resource.payee;
  if (payee) {
    logger.info(`[WEBHOOK] Payment captured - Receiver: ${payee.email || payee.merchant_id || 'Admin Account'}`);
    if (payee.email && !payee.email.includes(process.env.ADMIN_PAYPAL_EMAIL || '')) {
      logger.warn(`[WEBHOOK] WARNING: Payment receiver email (${payee.email}) may not be admin account.`);
    }
  }

  const updateResult = await Order.updateOne(
    {
      _id: order._id,
      paymentStatus: { $ne: 'paid' },
    },
    {
      $set: {
        paymentStatus: 'paid',
        orderStatus: 'processing',
        paypalCaptureId: captureId,
      },
    }
  );

  if (updateResult.matchedCount === 0) {
    logger.info(`[WEBHOOK] Order ${order._id} already marked as paid (idempotent webhook)`);
    return;
  }

  if (updateResult.modifiedCount === 0) {
    logger.info(`[WEBHOOK] Order ${order._id} update skipped (already paid)`);
    return;
  }

  logger.info(`[WEBHOOK] Order ${order._id} marked as paid via webhook`);
  if (order.userId) {
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
  }
};

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

  await blockPayoutsForOrder(order._id, "Order fully refunded (PayPal webhook) – payout cancelled");

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

const handlePayoutItemSucceeded = async (resource) => {
  const payoutItemId =
    resource.payout_item_id ||
    resource.payout_item?.payout_item_id ||
    resource.payout_item?.item_id;
  const payoutBatchId = resource.payout_batch_id;

  if (!payoutItemId && !payoutBatchId) {
    logger.warn('[WEBHOOK] PAYOUTS-ITEM.SUCCEEDED resource missing payout_item_id and payout_batch_id');
    return;
  }

  let payout = null;
  if (payoutItemId) {
    payout = await Payout.findOne({ paypalItemId: payoutItemId });
  }
  if (!payout && payoutBatchId) {
    payout = await Payout.findOne({ paypalBatchId: payoutBatchId });
  }

  if (!payout) {
    logger.warn('[WEBHOOK] Payout not found for PAYOUTS-ITEM.SUCCEEDED', {
      payoutItemId,
      payoutBatchId,
    });
    return;
  }

  if (payout.status === 'released') {
    logger.info('[WEBHOOK] Payout already marked as released (idempotent item webhook)', {
      payoutId: payout._id,
      payoutItemId,
      payoutBatchId,
    });
    return;
  }

  payout.status = 'released';
  payout.paypalBatchId = payoutBatchId || payout.paypalBatchId;
  payout.paypalItemId = payoutItemId || payout.paypalItemId;
  payout.paypalTransactionId = resource.transaction_id || payout.paypalTransactionId;
  payout.processedAt = payout.processedAt || new Date();
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
    description: `Payout item succeeded for order ${payout.orderId}`,
  });

  await auditLog(payout.sellerId, "PAYOUT_ITEM_SUCCEEDED", `Payout item succeeded for order ${payout.orderId}`, {
    payoutId: payout._id,
    payoutBatchId,
    payoutItemId,
  });
};

const handlePayoutItemFailed = async (resource) => {
  const payoutItemId =
    resource.payout_item_id ||
    resource.payout_item?.payout_item_id ||
    resource.payout_item?.item_id;
  const payoutBatchId = resource.payout_batch_id;

  if (!payoutItemId && !payoutBatchId) {
    logger.warn('[WEBHOOK] PAYOUTS-ITEM.FAILED resource missing payout_item_id and payout_batch_id');
    return;
  }

  let payout = null;
  if (payoutItemId) {
    payout = await Payout.findOne({ paypalItemId: payoutItemId });
  }
  if (!payout && payoutBatchId) {
    payout = await Payout.findOne({ paypalBatchId: payoutBatchId });
  }

  if (!payout) {
    logger.warn('[WEBHOOK] Payout not found for PAYOUTS-ITEM.FAILED', {
      payoutItemId,
      payoutBatchId,
    });
    return;
  }

  if (payout.status === 'failed') {
    logger.info('[WEBHOOK] Payout already marked as failed (idempotent item webhook)', {
      payoutId: payout._id,
      payoutItemId,
      payoutBatchId,
    });
    return;
  }

  payout.status = 'failed';
  payout.paypalBatchId = payoutBatchId || payout.paypalBatchId;
  payout.paypalItemId = payoutItemId || payout.paypalItemId;
  payout.paypalTransactionId = resource.transaction_id || payout.paypalTransactionId;
  payout.processedAt = payout.processedAt || new Date();
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
    description: `Payout item failed for order ${payout.orderId}`,
  });

  await auditLog(payout.sellerId, "PAYOUT_ITEM_FAILED", `Payout item failed for order ${payout.orderId}`, {
    payoutId: payout._id,
    payoutBatchId,
    payoutItemId,
  });
};

const handleCheckoutOrderApproved = async (resource) => {
  const paypalOrderId = resource.id;
  if (!paypalOrderId) {
    logger.warn('[WEBHOOK] CHECKOUT.ORDER.APPROVED missing order id');
    return;
  }

  const order = await Order.findOne({ paypalOrderId });
  if (!order) {
    logger.info('[WEBHOOK] CHECKOUT.ORDER.APPROVED received for PayPal order with no matching internal order yet', {
      paypalOrderId,
    });
    return;
  }

  logger.info('[WEBHOOK] CHECKOUT.ORDER.APPROVED matched internal order', {
    paypalOrderId,
    orderId: order._id,
    paymentStatus: order.paymentStatus,
    orderStatus: order.orderStatus,
  });
};

const handleCustomerDisputeCreated = async (resource) => {
  const disputeId = resource.dispute_id || resource.id;
  const status = resource.status;

  logger.warn('[WEBHOOK] CUSTOMER.DISPUTE.CREATED received', {
    disputeId,
    status,
    reason: resource.reason,
  });
};

const handleSubscriptionCreated = async (resource) => {
  const subscriptionId = resource.id;
  logger.info(`[WEBHOOK] Subscription created: ${subscriptionId}`);
};

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

