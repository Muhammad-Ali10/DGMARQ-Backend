import mongoose, { Schema } from "mongoose";

const cartItemSchema = new Schema(
  {
    productId: { type: Schema.Types.ObjectId, ref: "Product", required: true },
    sellerId: { type: Schema.Types.ObjectId, ref: "Seller", required: true },
    qty: { type: Number, default: 1 },
    unitPrice: { type: Number, required: true },
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
