import { asyncHandler } from "../utils/asyncHandler.js";
import { Review } from "../models/review.model.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { ApiError } from "../utils/ApiError.js";
import { updateValidateMongoIds } from "../utils/Idvalidation.js";

const createReview = asyncHandler(async (req, res) => {
  const { rating, comment, productId } = req.body;
  const userId = req.user;

  if (!rating) {
    throw new ApiError(400, "Rating is required");
  }

  if (!productId) {
    throw new ApiError(400, "Product ID is required");
  }

  updateValidateMongoIds([{ id: productId, name: "Product" }]);

  if (rating < 1 || rating > 5) {
    throw new ApiError(400, "Rating must be between 1 and 5");
  }
  if (!comment) {
    throw new ApiError(400, "Comment is required");
  }
  const review = await Review.create({
    productId,
    userId,
    rating,
    comment,
  });

  if (!review) {
    throw new ApiError(500, "Something went wrong while creating review");
  }


  res
    .status(201)
    .json(new ApiResponse(201,  review , "Review created successfully"));
});

export { createReview };
