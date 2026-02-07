import mongoose, { Schema } from "mongoose";
import { ORDER_STATUS, PAYMENT_STATUS } from "../constants.js";

const orderItemSchema = new Schema(
  {
    productId: { type: Schema.Types.ObjectId, ref: "Product", required: true },
    sellerId: { type: Schema.Types.ObjectId, ref: "Seller", required: true },
    qty: { type: Number, required: true },
    unitPrice: { type: Number, required: true },
    lineTotal: { type: Number, required: true },
    assignedKeyIds: [{ type: Schema.Types.ObjectId, ref: "LicenseKey" }],
    sellerEarning: { type: Number, default: 0 },
    commissionAmount: { type: Number, default: 10 },
    keyDeliveredAt: Date,
    keyDeliveryEmail: String,
    keyDeliveryStatus: {
      type: String,
      enum: ['pending', 'sent', 'failed'],
      default: 'pending'
    },
    keyDeliveryAttempts: { type: Number, default: 0 },
    refunded: { type: Boolean, default: false },
    refundedAt: Date,
    refundedKeysCount: { type: Number, default: 0 },
    refundedAmount: { type: Number, default: 0 },
    refundedSellerAmount: { type: Number, default: 0 },
  },
  { _id: false }
);

const orderSchema = new Schema(
  {
    checkoutId: { type: Schema.Types.ObjectId, ref: "Checkout", default: null },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: false, default: null },
    isGuest: { type: Boolean, default: false, index: true },
    guestEmail: { type: String, default: null, trim: true },
    orderNumber: { type: String, unique: true, sparse: true, index: true },
    items: [orderItemSchema],
    currency: { type: String, default: "USD" },
    subtotal: { type: Number, required: true },
    discount: { type: Number, default: 0 },
    totalAmount: { type: Number, required: true },
    buyerHandlingFee: { type: Number, default: 0 },
    grandTotal: { type: Number, default: null },
    adminEarnings: { type: Number, default: 0 },
    productSubtotal: { type: Number, default: null },
    handlingFee: { type: Number, default: 0 },
    commissionRate: { type: Number, default: null },
    commissionAmount: { type: Number, default: 0 },
    sellerEarning: { type: Number, default: 0 },
    adminEarning: { type: Number, default: 0 },
    totalPaid: { type: Number, default: null },
    paymentProvider: { type: String, enum: ["paypal", "wallet", "card"], default: null },
    payoutStatus: { type: String, enum: ["pending", "paid"], default: "pending" },
    payoutAmount: { type: Number, default: null },
    couponId: { type: Schema.Types.ObjectId, ref: "Coupon", default: null },
    paymentMethod: { type: String, enum: ["PayPal", "Card", "Wallet", "Wallet+Card"], default: "PayPal" },
    paymentStatus: { type: String, enum: PAYMENT_STATUS, default: "pending", index: true },
    paypalOrderId: { type: String, default: null, index: true, unique: true, sparse: true },
    paypalCaptureId: { type: String, default: null },
    paypalPayerId: { type: String, default: null },
    receiptUrl: { type: String, default: null },
    orderStatus: { type: String, enum: ORDER_STATUS, default: "pending", index: true },
    orderCompletedAt: { type: Date, default: null },
    payoutScheduledAt: Date,
    payoutId: { type: Schema.Types.ObjectId, ref: "Payout", default: null },
  },
  { timestamps: true }
);

orderSchema.index({ userId: 1, paymentStatus: 1, orderStatus: 1 });

orderSchema.pre("save", function (next) {
  if (this.isGuest) {
    if (!this.guestEmail || typeof this.guestEmail !== "string" || !this.guestEmail.trim()) {
      next(new Error("guestEmail is required when isGuest is true"));
      return;
    }
    this.userId = undefined;
  } else {
    if (!this.userId) {
      next(new Error("userId is required when isGuest is false"));
      return;
    }
  }
  next();
});

// Purpose: Stores customer orders with items, payment details, and fulfillment status
export const Order = mongoose.model("Order", orderSchema);
