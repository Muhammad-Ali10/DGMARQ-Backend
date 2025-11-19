import mongoose, { Schema } from "mongoose";
import { ORDER_STATUS, PAYMENT_STATUS } from "../constants.js";

const orderItemSchema = new Schema(
  {
    productId: { type: Schema.Types.ObjectId, ref: "Product", required: true },
    sellerId: { type: Schema.Types.ObjectId, ref: "Seller", required: true },
    qty: { type: Number, required: true },
    unitPrice: { type: Number, required: true },
    lineTotal: { type: Number, required: true },
    assignedKeyId: { type: Schema.Types.ObjectId, ref: "LicenseKey", default: null },
    sellerEarning: { type: Number, default: 0 },
    commissionAmount: { type: Number, default: 10 },
  },
  { _id: false }
);

const orderSchema = new Schema(
  {
    checkoutId: { type: Schema.Types.ObjectId, ref: "Checkout", default: null },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    items: [orderItemSchema],
    currency: { type: String, default: "EUR" },
    subtotal: { type: Number, required: true },
    discount: { type: Number, default: 0 },
    totalAmount: { type: Number, required: true },
    couponId: { type: Schema.Types.ObjectId, ref: "Coupon", default: null },
    paymentMethod: { type: String, enum: ["PayPal"], default: "PayPal" },
    paymentStatus: { type: String, enum: PAYMENT_STATUS, default: "pending", index: true },
    paypalOrderId: { type: String, default: null },
    paypalCaptureId: { type: String, default: null },
    receiptUrl: { type: String, default: null },
    orderStatus: { type: String, enum: ORDER_STATUS, default: "pending", index: true },
  },
  { timestamps: true }
);

orderSchema.index({ userId: 1, paymentStatus: 1, orderStatus: 1 });

export const Order = mongoose.model("Order", orderSchema);
