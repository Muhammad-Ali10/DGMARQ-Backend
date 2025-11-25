import mongoose from "mongoose";
import { asyncHandler } from "../utils/asyncHandler.js";
import { Review } from "../models/review.model.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { ApiError } from "../utils/ApiError.js";
import { updateValidateMongoIds } from "../utils/Idvalidation.js";
import { calculateAverageRating } from "../services/review.service.js";


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

  const existingReview = await Review.findOne({ productId, userId });

  if (existingReview) {
    throw new ApiError(400, "You have already reviewed this product");
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

  await calculateAverageRating(productId);

  res
    .status(201)
    .json(new ApiResponse(201, review, "Review created successfully"));
});

const updateReview = asyncHandler(async (req, res) => {
  const { rating, comment } = req.body;
  const { id } = req.params;
  const userId = req.user;

  updateValidateMongoIds([{ id, name: "Review" }]);

  if (!rating || rating < 1 || rating > 5) {
    throw new ApiError(400, "Rating must be between 1 and 5");
  }

  if (!comment || comment.trim() === "") {
    throw new ApiError(400, "Comment is required");
  }

  const review = await Review.findOneAndUpdate(
    { _id: id, userId },
    { rating, comment },
    { new: true }
  );

  if (!review) {
    throw new ApiError(404, "Review not found");
  }

  await calculateAverageRating(review.productId);

  res
    .status(200)
    .json(new ApiResponse(200, review, "Review updated successfully"));
});

const deleteReview = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const userId = req.user;

  if (!id) {
    throw new ApiError(400, "Review ID is required");
  }

  updateValidateMongoIds([{ id, name: "Review" }]);

  const review = await Review.findOneAndDelete({ _id: id, userId });

  if (!review) {
    throw new ApiError(404, "Review not found");
  }

  await calculateAverageRating(review.productId);

  res
    .status(200)
    .json(new ApiResponse(200, null, "Review deleted successfully"));
});

const getReviews = asyncHandler(async (req, res) => {
  const { page = 1, limit = 10, productId, rating, sortBy } = req.query;

  const ReviewAggragation = Review.aggregate([
    {
      $match: {
        ...(productId && { productId: new mongoose.Types.ObjectId(productId) }),
        ...(rating && { rating: Number(rating) }),
      },
    },
  ]);

  const options = {
    page: Number(page),
    limit: Number(limit),
    sort: { ...(sortBy === "rating" ? { rating: -1 } : { createdAt: -1 }) },
  };

  const reviews = await Review.aggregatePaginate(ReviewAggragation, options);
  console.log(reviews);
  if (!reviews) {
    throw new ApiError(404, "Reviews not found");
  }

  res
    .status(200)
    .json(new ApiResponse(200, reviews, "Reviews fetched successfully"));
});

export { createReview, updateReview, deleteReview, getReviews };
