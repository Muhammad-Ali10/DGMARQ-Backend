import mongoose from "mongoose";
import { DISCOUNT_TYPE } from "../constants.js";


const productDiscountSchema = new Schema(
  {
    productId: { type: Schema.Types.ObjectId, ref: "Product", required: true, index: true },
    discountType: { type: String, enum: DISCOUNT_TYPE, required: true },
    discountValue: { type: Number, required: true },
    banner: String,
    isActive: { type: Boolean, default: true },
    startDate: Date,
    endDate: Date,
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
)

export const ProductDiscount = mongoose.model("ProductDiscount", productDiscountSchema)
