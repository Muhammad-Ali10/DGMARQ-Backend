import mongoose from "mongoose";
import { Product } from "../models/product.model.js";
import { Review } from "../models/review.model.js";
import { ApiError } from "../utils/ApiError.js";
import { logger } from "../utils/logger.js";
import { updateValidateMongoIds } from "../utils/Idvalidation.js";

export const calculateAverageRating = async (productId) => {

  if (!productId) {
    throw new ApiError(400, "Product ID is required");
  }

  logger.debug("Calculating average rating for product", { productId });
  
  updateValidateMongoIds([{ id: productId, name: "Product" }]);

  // Only count valid, non-refunded reviews for product rating (marketplace rule: exclude invalidated/full-refund)
  const result = await Review.aggregate([
    {
      $match: {
        productId: new mongoose.Types.ObjectId(productId),
        isInvalidated: { $ne: true },
      },
    },
    {
      $group: {
        _id: "$productId",
        averageRating: { $avg: "$rating" },
        reviewCount: { $sum: 1 },
      },
    },
  ]);

  const { averageRating, reviewCount } = result[0] || {
    averageRating: 0,
    reviewCount: 0,
  };

  await Product.findByIdAndUpdate(
    productId,
    { averageRating, reviewCount },
    { new: true }
  );

  return { averageRating, reviewCount };
};

/**
 * Invalidates all reviews for an order (e.g. when order is fully refunded).
 * Invalidated reviews are excluded from product/seller ratings and from public listing.
 * Returns { modifiedCount, productIds } so callers can recalculate product ratings.
 */
export const invalidateReviewsForOrder = async (orderId) => {
  if (!orderId) return { modifiedCount: 0, productIds: [] };
  updateValidateMongoIds([{ id: orderId, name: "Order" }]);
  const toInvalidate = await Review.find({ orderId, isInvalidated: { $ne: true } }).select("productId").lean();
  const productIds = [...new Set(toInvalidate.map((r) => r.productId?.toString()).filter(Boolean))];
  const result = await Review.updateMany(
    { orderId },
    { $set: { isInvalidated: true } }
  );
  if (result.modifiedCount > 0) {
    logger.debug("Invalidated reviews for fully refunded order", { orderId, modifiedCount: result.modifiedCount });
  }
  return { modifiedCount: result.modifiedCount, productIds };
};
