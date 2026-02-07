import mongoose, { Schema } from "mongoose";

const wishlistSchema = new Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  products: [
    {
      productId: { type: mongoose.Schema.Types.ObjectId, ref: "Product" },
      addedAt: { type: Date, default: Date.now }
    }
  ]
});

// Purpose: Stores user wishlists containing saved products for future purchase
export const Wishlist = mongoose.model("Wishlist", wishlistSchema)
