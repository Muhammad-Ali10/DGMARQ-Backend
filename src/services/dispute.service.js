import { Dispute } from "../models/dispute.model.js";
import { Order } from "../models/order.model.js";
import { LicenseKey } from "../models/licensekey.model.js";

export const isOrderEligibleForDispute = async (orderId, userId) => {
  const order = await Order.findOne({
    _id: orderId,
    userId,
    paymentStatus: "paid",
  });

  if (!order) {
    return { eligible: false, reason: "Order not found or not paid" };
  }

  // Check if dispute already exists
  const existingDispute = await Dispute.findOne({ orderId, userId });
  if (existingDispute) {
    return { eligible: false, reason: "Dispute already exists for this order" };
  }

  // Check if order is within dispute period (30 days)
  const daysSinceOrder = (new Date() - order.createdAt) / (1000 * 60 * 60 * 24);
  if (daysSinceOrder > 30) {
    return { eligible: false, reason: "Dispute period has expired (30 days)" };
  }

  return { eligible: true };
};

export const autoResolveDispute = async (disputeId) => {
  const dispute = await Dispute.findById(disputeId).populate("orderId");

  if (!dispute || dispute.status !== "open") {
    return false;
  }

  const order = dispute.orderId;
  const orderItem = order.items[0];

  if (orderItem && orderItem.assignedKeyIds && orderItem.assignedKeyIds.length > 0) {
    const licenseKeyDoc = await LicenseKey.findOne({
      productId: orderItem.productId,
    });

    if (licenseKeyDoc) {
      const relevantKeys = licenseKeyDoc.keys.filter(key =>
        orderItem.assignedKeyIds.some(id => id.toString() === key._id.toString())
      );

      const hasValidKey = relevantKeys.some(key => !key.isUsed);
      
      if (hasValidKey) {
        dispute.status = "investigating";
        await dispute.save();
        return true;
      }
    }
  }

  return false;
};

export const calculateRefundAmount = (order, disputeType) => {
  // Full refund for key issues
  if (["key_not_working", "wrong_key", "key_already_used"].includes(disputeType)) {
    return order.totalAmount;
  }

  // Partial refund for other issues (50%)
  return order.totalAmount * 0.5;
};

