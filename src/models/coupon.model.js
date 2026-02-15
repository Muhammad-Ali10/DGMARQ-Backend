import mongoose, { Schema } from "mongoose";
import { COUPON_TYPE } from "../constants.js";

const couponSchema = new Schema(
  {
    code: { type: String, required: true, unique: true, uppercase: true, trim: true },
    discountType: { type: String, enum: COUPON_TYPE, required: true },
    discountValue: { type: Number, required: true },
    minOrderAmount: { type: Number, default: 0 },
    usageLimit: { type: Number, default: 0 },
    usedCount: { type: Number, default: 0 },
    perUserLimit: { type: Number, default: 0 },
    scope: { 
      type: String, 
      enum: ['global', 'product', 'seller'], 
      default: 'global' 
    },
    productIds: [{ type: Schema.Types.ObjectId, ref: "Product" }],
    sellerIds: [{ type: Schema.Types.ObjectId, ref: "Seller" }],
    isExclusive: { type: Boolean, default: false },
    startDate: Date,
    endDate: Date,
    isActive: { type: Boolean, default: true },
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
)

couponSchema.index({ scope: 1, productIds: 1 })
couponSchema.index({ scope: 1, sellerIds: 1 })

export const Coupon = mongoose.model("Coupon", couponSchema)
