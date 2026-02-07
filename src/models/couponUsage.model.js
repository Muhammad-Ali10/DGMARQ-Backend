import mongoose, { Schema } from "mongoose";

const couponUsageSchema = new Schema(
  {
    couponId: { type: Schema.Types.ObjectId, ref: "Coupon", required: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    orderId: { type: Schema.Types.ObjectId, ref: "Order", required: true },
    usedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

couponUsageSchema.index({ couponId: 1, userId: 1 });

// Purpose: Tracks coupon usage history by user and order
export const CouponUsage = mongoose.model("CouponUsage", couponUsageSchema);

