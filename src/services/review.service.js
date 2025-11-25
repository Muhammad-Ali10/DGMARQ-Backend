import mongoose from "mongoose";
import { Product } from "../models/product.model.js";
import { Review } from "../models/review.model.js";
import { ApiError } from "../utils/ApiError.js";
import { updateValidateMongoIds } from "../utils/Idvalidation.js";

export const calculateAverageRating = async (productId) => {

  if (!productId) {
    throw new ApiError(400, "Product ID is required");
  }

  console.log("Calculating average rating for product:", productId);
  
  updateValidateMongoIds([{ id: productId, name: "Product" }]);

  const result = await Review.aggregate([
    {
      $match: { productId: new mongoose.Types.ObjectId(productId) },
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
