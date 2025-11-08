import mongoose from "mongoose";

const { DISCOUNT_TYPE } = require("./constants")

const categoryOfferSchema = new mongoose.Schema(
  {
    categoryId: { type: Schema.Types.ObjectId, ref: "Category", required: true },
    discountType: { type: String, enum: DISCOUNT_TYPE, required: true },
    discountValue: { type: Number, required: true },
    banner: String,
    isActive: { type: Boolean, default: true },
    startDate: Date,
    endDate: Date,
  },
  { timestamps: true },
)

export const CategoryOffer = mongoose.model("CategoryOffer", categoryOfferSchema)
