import mongoose from "mongoose";

const { BESTSELLER_PERIOD } = require("./constants")

const bestSellerSchema = new mongoose.Schema(
  {
    productId: { type: Schema.Types.ObjectId, ref: "Product", required: true },
    categoryId: { type: Schema.Types.ObjectId, ref: "Category" },
    ranking: { type: Number },
    period: { type: String, enum: BESTSELLER_PERIOD },
  },
  { timestamps: true },
)

export const BestSeller = mongoose.model("BestSeller", bestSellerSchema)
