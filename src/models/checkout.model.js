import mongoose, { Schema } from "mongoose";

const checkoutItemSchema = new Schema(
  {
    productId: { type: Schema.Types.ObjectId, ref: "Product", required: true },
    sellerId: { type: Schema.Types.ObjectId, ref: "Seller", required: true },
    name: { type: String, required: true },
    qty: { type: Number, required: true },
    unitPrice: { type: Number, required: true },
    lineTotal: { type: Number, required: true },
    assignedKeyId: { type: Schema.Types.ObjectId, ref: "LicenseKey", default: null },
  },
  { _id: false }
);

const checkoutSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    items: [checkoutItemSchema],
    subtotal: { type: Number, required: true },
    discount: { type: Number, default: 0 },
    bundleDiscount: { type: Number, default: 0 },
    bundleDealId: { type: Schema.Types.ObjectId, ref: "BundleDeal", default: null },
    subscriptionDiscount: { type: Number, default: 0 },
    couponDiscount: { type: Number, default: 0 },
    totalAmount: { type: Number, required: true },
    couponId: { type: Schema.Types.ObjectId, ref: "Coupon", default: null },
    hasSubscription: { type: Boolean, default: false },
    paymentMethod: { type: String, enum: ["PayPal", "Card"], default: "PayPal" },
    paypalOrderId: { type: String, default: null },
    paypalApprovalUrl: { type: String, default: null },
    status: { type: String, enum: ["pending", "expired", "paid", "cancelled"], default: "pending", index: true },
    expiresAt: { type: Date, default: () => new Date(Date.now() + 30 * 60 * 1000) },
  },
  { timestamps: true }
);

checkoutSchema.index({ userId: 1, status: 1 });

export const Checkout = mongoose.model("Checkout", checkoutSchema);
