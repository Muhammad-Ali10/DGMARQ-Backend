import mongoose from "mongoose";
const { COUPON_TYPE } = require("./constants")

const couponSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, unique: true, uppercase: true, trim: true },
    discountType: { type: String, enum: COUPON_TYPE, required: true },
    discountValue: { type: Number, required: true },
    minOrderAmount: { type: Number, default: 0 },
    usageLimit: { type: Number, default: 0 }, // 0 = unlimited
    usedCount: { type: Number, default: 0 },
    startDate: Date,
    endDate: Date,
    isActive: { type: Boolean, default: true },
    createdBy: { type: Schema.Types.ObjectId, ref: "User" }, // admin
  },
  { timestamps: true },
)

couponSchema.index({ code: 1 })

export const Coupon = mongoose.model("Coupon", couponSchema)
