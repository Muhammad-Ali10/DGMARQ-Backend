import mongoose, { Schema } from "mongoose";

const cartItemSchema = new Schema(
  {
    productId: { type: Schema.Types.ObjectId, ref: "Product", required: true },
    sellerId: { type: Schema.Types.ObjectId, ref: "Seller", required: true },
    qty: { type: Number, default: 1 },
    unitPrice: { type: Number, required: true },
    originalPrice: { type: Number, required: true },
    discountedPrice: { type: Number, required: true },
    discountAmount: { type: Number, default: 0 },
    discountPercentage: { type: Number, default: 0 },
    discountType: { type: String, enum: ['product_discount', 'flash_deal', 'trending_offer', null], default: null },
    discountSource: { type: Schema.Types.ObjectId, default: null },
  },
  { _id: false }
);

const cartSchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    items: [cartItemSchema],
  },
  { timestamps: true }
);

export const Cart = mongoose.model("Cart", cartSchema);
