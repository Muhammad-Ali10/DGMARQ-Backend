import mongoose from "mongoose";
import mongooseAggregatePaginate from "mongoose-aggregate-paginate-v2";

const reviewSchema = new mongoose.Schema(
  {
    productId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: true,
      index: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    orderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Order",
      required: true,
      index: true
    },
    // Seller at time of review; used for seller rating aggregation and dashboard consistency
    sellerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Seller",
      required: false, // backward compat for existing reviews
      index: true,
    },
    rating: { type: Number, required: true, min: 1, max: 5 },
    comment: { type: String, trim: true },
    isVerifiedPurchase: { type: Boolean, default: true },
    helpfulCount: { type: Number, default: 0 },
    reportedCount: { type: Number, default: 0 },
    isModerated: { type: Boolean, default: false },
    moderationStatus: { 
      type: String, 
      enum: ['pending', 'approved', 'rejected'], 
      default: 'pending' 
    },
    moderationReason: { type: String, default: null },
    isHidden: { type: Boolean, default: false },
    // When order is fully refunded, review is invalidated: excluded from ratings and listings
    isInvalidated: { type: Boolean, default: false, index: true },
  },
  { timestamps: true }
);

// One review per buyer per product per order (prevents duplicate reviews under race conditions)
reviewSchema.index({ productId: 1, userId: 1, orderId: 1 }, { unique: true });

reviewSchema.plugin(mongooseAggregatePaginate);

// Purpose: Stores product reviews and ratings submitted by users
export const Review = mongoose.model("Review", reviewSchema);
