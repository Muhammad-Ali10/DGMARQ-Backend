import e from "express";
import mongoose from "mongoose";

const reviewSchema = new mongoose.Schema(
  {
    productId: { type: Schema.Types.ObjectId, ref: "Product", required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    rating: { type: Number, required: true },
    comment: String,
  },
  { timestamps: true },
)

export const Review = mongoose.model("Review", reviewSchema)
