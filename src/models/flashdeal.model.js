import mongoose, { Schema } from "mongoose";

const flashDealSchema = new mongoose.Schema(
  {
    productId: { type: Schema.Types.ObjectId, ref: "Product", required: true, index: true },
    discountPercentage: { type: Number, required: true, min: 1, max: 90 }, // Percentage discount
    banner: String,
    isActive: { type: Boolean, default: true, index: true },
    startDate: { type: Date, required: true, index: true },
    endDate: { type: Date, required: true, index: true },
  },
  { timestamps: true },
)

export const FlashDeal = mongoose.model("FlashDeal", flashDealSchema)
