import e from "express";
import mongoose from "mongoose";

const flashDealSchema = new mongoose.Schema(
  {
    productId: { type: Schema.Types.ObjectId, ref: "Product", required: true },
    discount: { type: Number, required: true }, // percent or fixed? choose percent if consistent
    banner: String,
    isActive: { type: Boolean, default: true },
    startDate: Date,
    endDate: Date,
  },
  { timestamps: true },
)

export const FlashDeal = mongoose.model("FlashDeal", flashDealSchema)
