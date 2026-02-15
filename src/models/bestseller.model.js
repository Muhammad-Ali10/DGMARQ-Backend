import mongoose, { Schema } from "mongoose";

const bestSellerSchema = new Schema(
  {
    sellerId: { 
      type: Schema.Types.ObjectId, 
      ref: "Seller", 
      required: true,
      index: true
    },
    productId: { 
      type: Schema.Types.ObjectId, 
      ref: "Product", 
      required: true,
      index: true
    },
    calculatedRating: { 
      type: Number, 
      required: true,
      index: true
    },
    generatedAt: { 
      type: Date, 
      default: Date.now,
      index: true
    },
  },
  { timestamps: true },
)

bestSellerSchema.index({ sellerId: 1, generatedAt: -1 });
bestSellerSchema.index({ calculatedRating: -1, generatedAt: -1 });

export const BestSeller = mongoose.model("BestSeller", bestSellerSchema)
