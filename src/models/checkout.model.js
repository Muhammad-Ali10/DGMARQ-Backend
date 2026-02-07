import mongoose, { Schema } from "mongoose";

const checkoutItemSchema = new Schema(
  {
    productId: { type: Schema.Types.ObjectId, ref: "Product", required: true },
    sellerId: { type: Schema.Types.ObjectId, ref: "Seller", required: true },
    name: { type: String, required: true },
    qty: { type: Number, required: true },
    unitPrice: { type: Number, required: true },
    originalPrice: { type: Number, required: true },
    discountedPrice: { type: Number, required: true },
    discountAmount: { type: Number, default: 0 },
    discountPercentage: { type: Number, default: 0 },
    discountType: { type: String, enum: ['product_discount', 'flash_deal', 'trending_offer', null], default: null },
    lineTotal: { type: Number, required: true },
    assignedKeyId: { type: Schema.Types.ObjectId, ref: "LicenseKey", default: null },
  },
  { _id: false }
);

const checkoutSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: false, default: null },
    isGuest: { type: Boolean, default: false, index: true },
    guestEmail: { type: String, default: null, trim: true },
    items: [checkoutItemSchema],
    subtotal: { type: Number, required: true },
    discount: { type: Number, default: 0 },
    bundleDiscount: { type: Number, default: 0 },
    bundleDealId: { type: Schema.Types.ObjectId, ref: "BundleDeal", default: null },
    subscriptionDiscount: { type: Number, default: 0 },
    couponDiscount: { type: Number, default: 0 },
    totalAmount: { type: Number, required: true },
    buyerHandlingFee: { type: Number, default: 0 },
    grandTotal: { type: Number, default: null },
    walletAmount: { type: Number, default: 0 },
    cardAmount: { type: Number, default: 0 },
    couponId: { type: Schema.Types.ObjectId, ref: "Coupon", default: null },
    hasSubscription: { type: Boolean, default: false },
    paymentMethod: { type: String, enum: ["PayPal", "Card", "Wallet", "Wallet+Card"], default: "PayPal" },
    paypalOrderId: { type: String, default: null },
    paypalApprovalUrl: { type: String, default: null },
    status: { type: String, enum: ["pending", "expired", "paid", "cancelled"], default: "pending", index: true },
    expiresAt: { type: Date, default: () => new Date(Date.now() + 30 * 60 * 1000) },
  },
  { timestamps: true }
);

checkoutSchema.index({ userId: 1, status: 1 });
checkoutSchema.index({ isGuest: 1, status: 1 });

checkoutSchema.pre("save", function (next) {
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

// Purpose: Manages checkout sessions with payment details, discounts, and order totals
export const Checkout = mongoose.model("Checkout", checkoutSchema);
