import { Seller } from "../models/seller.model.js";
import { Product } from "../models/product.model.js";
import { User } from "../models/user.model.js";
import { Order } from "../models/order.model.js";
import { createNotification } from "./notification.service.js";
import {
  sendRefundIssuedEmailToSeller,
  sendRefundRequestedEmailToSeller,
  sendSellerInputRequestEmailToSeller,
} from "./email.service.js";
import { logger } from "../utils/logger.js";

/**
 * Purpose: Notify seller when a customer has requested a refund (request created; admin will review).
 * Creates in-app notification and sends email so the seller is aware and can add feedback.
 *
 * @param {Object} params
 * @param {Object} params.order - Order document (must have _id, orderNumber)
 * @param {Object} params.refund - Refund document (sellerId, productId, refundAmount)
 */
export const notifySellerOfRefundRequested = async ({ order, refund }) => {
  const sellerId = refund.sellerId?._id ?? refund.sellerId;
  const productId = refund.productId?._id ?? refund.productId;
  const orderId = order._id;

  if (!sellerId || !orderId) {
    logger.warn("[refundNotification] Missing sellerId or orderId, skipping refund-requested notification", { sellerId, orderId });
    return;
  }

  try {
    const seller = await Seller.findById(sellerId).select("userId status accountBlocked").lean();
    if (!seller || !seller.userId) {
      logger.warn("[refundNotification] Seller not found or has no userId", { sellerId });
      return;
    }

    const sellerUserId = seller.userId;
    let productName = "Product";
    if (productId) {
      const product = await Product.findById(productId).select("name").lean();
      if (product?.name) productName = product.name;
    }

    const orderDisplay = order.orderNumber || order._id?.toString() || orderId.toString();
    const refundAmount = refund.refundAmount ?? 0;
    const message = `A customer has requested a refund of $${Number(refundAmount).toFixed(2)} for Order #${orderDisplay}. Admin will review.`;

    const actionUrl = "/seller/return-refunds";
    const notificationData = {
      orderId,
      sellerId,
      refundAmount,
      productName,
      type: "refund_requested",
    };

    await createNotification(
      sellerUserId,
      "refund",
      "Refund Requested",
      message,
      notificationData,
      actionUrl,
      "high"
    );

    const sellerUser = await User.findById(sellerUserId).select("email name").lean();
    if (!sellerUser?.email) {
      logger.warn("[refundNotification] Seller user or email not found, skipping refund-requested email", { sellerUserId });
      return;
    }

    await sendRefundRequestedEmailToSeller({
      sellerUser,
      orderNumber: orderDisplay,
      productName,
      refundAmount,
    });
  } catch (err) {
    logger.error("[refundNotification] Failed to notify seller of refund request", {
      orderId,
      sellerId,
      refundId: refund._id,
      err: err.message,
    });
  }
};

/**
 * Purpose: Notify seller when a refund is issued (partial or full).
 * Called only after refund status is COMPLETED (confirmed) — never during pending.
 * Creates in-app notification and sends email. One notification per refund event.
 *
 * @param {Object} params
 * @param {Object} params.order - Order document (must have _id, orderNumber, items, userId)
 * @param {Object} params.refund - Refund document (sellerId, productId, refundAmount, orderId)
 * @param {string} params.refundType - "full" | "partial"
 * @param {number} params.refundAmount - Amount refunded
 * @param {string} params.payoutStatus - "HELD" | "RELEASED" (whether payout was still held or already released)
 */
export const notifySellerOfRefund = async ({ order, refund, refundType, refundAmount, payoutStatus }) => {
  const sellerId = refund.sellerId?._id ?? refund.sellerId;
  const productId = refund.productId?._id ?? refund.productId;
  const orderId = order._id;

  if (!sellerId || !orderId) {
    logger.warn("[refundNotification] Missing sellerId or orderId, skipping seller notification", { sellerId, orderId });
    return;
  }

  try {
    const seller = await Seller.findById(sellerId).select("userId status accountBlocked").lean();
    if (!seller || !seller.userId) {
      logger.warn("[refundNotification] Seller not found or has no userId", { sellerId });
      return;
    }

    const sellerUserId = seller.userId;
    if (seller.status === "banned" || seller.accountBlocked) {
      logger.warn("[refundNotification] Seller account suspended or blocked; still sending refund notification", {
        sellerId,
        status: seller.status,
        accountBlocked: seller.accountBlocked,
      });
    }

    let productName = "Product";
    if (productId) {
      const product = await Product.findById(productId).select("name").lean();
      if (product?.name) productName = product.name;
    }

    const orderDisplay = order.orderNumber || order._id?.toString() || orderId.toString();
    const message = `Refund Issued: $${Number(refundAmount).toFixed(2)} has been refunded for Order #${orderDisplay}.`;

    const actionUrl = `/seller/orders/${orderId}`;
    const notificationData = {
      orderId,
      sellerId,
      refundAmount,
      refundType,
      productName,
      payoutStatus,
    };

    await createNotification(
      sellerUserId,
      "refund",
      "Refund Issued",
      message,
      notificationData,
      actionUrl,
      "high"
    );

    const sellerUser = await User.findById(sellerUserId).select("email name").lean();
    if (!sellerUser?.email) {
      logger.warn("[refundNotification] Seller user or email not found, skipping refund email", { sellerUserId });
      return;
    }

    let buyerName = null;
    if (order.userId) {
      const buyer = await User.findById(order.userId).select("name").lean();
      if (buyer?.name) buyerName = buyer.name;
    }

    const refundMethod = refund.refundMethod || 'WALLET';
    await sendRefundIssuedEmailToSeller({
      sellerUser,
      orderNumber: orderDisplay,
      productName,
      buyerName,
      refundAmount,
      refundType,
      payoutStatus,
      refundMethod,
    });
  } catch (err) {
    logger.error("[refundNotification] Failed to notify seller of refund", {
      orderId,
      sellerId,
      refundId: refund._id,
      err: err.message,
    });
  }
};

/**
 * Purpose: Notify seller when admin explicitly requests their input on a refund.
 * Creates in-app notification and sends email with context and the admin's note.
 *
 * @param {Object} params
 * @param {Object} params.refund - Refund document (must include orderId, productId, sellerId, userId)
 * @param {string} [params.note] - Optional admin note/request message
 */
export const notifySellerOfSellerInputRequest = async ({ refund, note }) => {
  const sellerId = refund.sellerId?._id ?? refund.sellerId;
  const productId = refund.productId?._id ?? refund.productId;
  const orderId = refund.orderId?._id ?? refund.orderId;

  if (!sellerId || !orderId) {
    logger.warn("[refundNotification] Missing sellerId or orderId, skipping seller-input notification", {
      sellerId,
      orderId,
      refundId: refund._id,
    });
    return;
  }

  try {
    const [seller, product, order, customer] = await Promise.all([
      Seller.findById(sellerId).select("userId shopName").lean(),
      productId ? Product.findById(productId).select("name").lean() : null,
      Order.findById(orderId).select("_id orderNumber").lean(),
      refund.userId ? User.findById(refund.userId).select("name").lean() : null,
    ]);

    if (!seller || !seller.userId) {
      logger.warn("[refundNotification] Seller not found or has no userId for seller-input request", {
        sellerId,
        refundId: refund._id,
      });
      return;
    }

    const sellerUserId = seller.userId;
    const productName = product?.name || "Product";
    const orderDisplay = order?.orderNumber || order?._id?.toString() || orderId.toString();
    const customerName = customer?.name || "Customer";
    const adminMessage = typeof note === "string" && note.trim() ? note.trim() : null;

    let message = `Admin requested your input on a refund for Order #${orderDisplay} (${productName}) from ${customerName}.`;
    if (adminMessage) {
      message += ` Message from admin: "${adminMessage}".`;
    }

    const actionUrl = `/seller/return-refunds/${refund._id?.toString?.() || refund._id}`;
    const notificationData = {
      refundId: refund._id,
      orderId,
      sellerId,
      productName,
      customerName,
      adminMessage,
      type: "seller_input_requested",
    };

    await createNotification(
      sellerUserId,
      "refund",
      "Admin Requested Your Input on a Refund",
      message,
      notificationData,
      actionUrl,
      "high"
    );

    const sellerUser = await User.findById(sellerUserId).select("email name").lean();
    if (!sellerUser?.email) {
      logger.warn("[refundNotification] Seller user or email not found, skipping seller-input email", { sellerUserId });
      return;
    }

    await sendSellerInputRequestEmailToSeller({
      sellerUser,
      refundId: refund._id?.toString?.() || refund._id,
      orderNumber: orderDisplay,
      productName,
      customerName,
      adminMessage,
    });
  } catch (err) {
    logger.error("[refundNotification] Failed to notify seller of seller-input request", {
      refundId: refund._id,
      sellerId,
      orderId,
      err: err.message,
    });
  }
};
