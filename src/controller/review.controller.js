import mongoose from "mongoose";
import { asyncHandler } from "../utils/asyncHandler.js";
import { Review } from "../models/review.model.js";
import { ReviewReply } from "../models/reviewReply.model.js";
import { ReviewVote } from "../models/reviewVote.model.js";
import { ReviewPhoto } from "../models/reviewPhoto.model.js";
import { Product } from "../models/product.model.js";
import { Seller } from "../models/seller.model.js";
import { Order } from "../models/order.model.js";
import { ReturnRefund } from "../models/returnrefund.model.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { ApiError } from "../utils/ApiError.js";
import { updateValidateMongoIds } from "../utils/Idvalidation.js";
import { calculateAverageRating } from "../services/review.service.js";
import { fileUploader } from "../utils/cloudinary.js";


// Purpose: Creates a review for a product after verifying purchase in the specified order.
// Marketplace rules: only completed/partially-refunded orders; one review per product per order; no review if order in dispute.
const createReview = asyncHandler(async (req, res) => {
  const { rating, comment, productId, orderId } = req.body;
  const userId = req.user._id; // Guest users cannot reach this (verifyJWT required)

  if (!rating && rating !== 0) {
    throw new ApiError(400, "Rating is required");
  }
  if (rating < 1 || rating > 5) {
    throw new ApiError(400, "Rating must be between 1 and 5. Zero-star ratings are not allowed.");
  }

  if (!productId) {
    throw new ApiError(400, "Product ID is required. Please provide a valid product ID.");
  }

  if (!orderId) {
    throw new ApiError(400, "Order ID is required. Reviews can only be created after purchase.");
  }

  try {
    updateValidateMongoIds([{ id: productId, name: "Product" }, { id: orderId, name: "Order" }]);
  } catch (error) {
    if (error.message.includes("Invalid Product ID")) {
      throw new ApiError(400, `Invalid product ID format. The product ID must be a valid MongoDB ObjectId. Received: ${productId}`);
    }
    if (error.message.includes("Invalid Order ID")) {
      throw new ApiError(400, `Invalid order ID format. The order ID must be a valid MongoDB ObjectId. Received: ${orderId}`);
    }
    throw error;
  }

  // Only completed or partially refunded orders: buyer can still leave one review per product per order (partial refund does not remove review)
  const order = await Order.findOne({
    _id: orderId,
    userId,
    paymentStatus: 'paid',
    orderStatus: { $in: ['completed', 'PARTIALLY_REFUNDED', 'partially_completed'] },
  });

  if (!order) {
    throw new ApiError(404, "Order not found or not completed. Only buyers with a completed order can leave a review.");
  }

  // Block review if order has an open refund request (order in dispute)
  const openRefund = await ReturnRefund.findOne({
    orderId,
    status: { $in: ['PENDING', 'SELLER_REVIEW', 'SELLER_APPROVED', 'ADMIN_REVIEW', 'ADMIN_APPROVED', 'pending', 'approved'] },
  });
  if (openRefund) {
    throw new ApiError(400, "You cannot submit a review while this order has an open refund request. Please wait until the refund is resolved.");
  }

  const product = await Product.findById(productId);
  if (!product) {
    throw new ApiError(404, `Product not found. The product with ID ${productId} does not exist.`);
  }

  const orderItem = order.items.find(item => (item.productId?.toString?.() || item.productId?._id?.toString?.()) === productId.toString());
  if (!orderItem) {
    throw new ApiError(400, "This product was not purchased in this order. Please ensure you are reviewing a product from your completed orders.");
  }

  const trimmedComment = typeof comment === "string" ? comment.trim() : "";
  if (!trimmedComment) {
    throw new ApiError(400, "Comment is required and cannot be empty.");
  }

  // Duplicate protection: one review per product per order (unique index also prevents race duplicates)
  const existingReview = await Review.findOne({ productId, userId, orderId });
  if (existingReview) {
    throw new ApiError(400, "You have already submitted a review for this product in this order. Only one review per product per order is allowed.");
  }

  const sellerId = orderItem.sellerId?._id || orderItem.sellerId || product.sellerId;

  const review = await Review.create({
    productId,
    userId,
    orderId,
    sellerId: sellerId || undefined,
    rating,
    comment: trimmedComment,
    isVerifiedPurchase: true,
  });

  if (!review) {
    throw new ApiError(500, "Something went wrong while creating review");
  }

  await calculateAverageRating(productId);

  res
    .status(201)
    .json(new ApiResponse(201, review, "Review created successfully"));
});

// Purpose: Updates an existing review by the review owner. Editing allowed only before any refund is processed for the order.
const updateReview = asyncHandler(async (req, res) => {
  const { rating, comment } = req.body;
  const { id } = req.params;
  const userId = req.user._id;

  updateValidateMongoIds([{ id, name: "Review" }]);

  if (!rating || rating < 1 || rating > 5) {
    throw new ApiError(400, "Rating must be between 1 and 5");
  }

  const trimmedComment = typeof comment === "string" ? comment.trim() : "";
  if (!trimmedComment) {
    throw new ApiError(400, "Comment is required and cannot be empty.");
  }

  const review = await Review.findOne({ _id: id, userId });
  if (!review) {
    throw new ApiError(404, "Review not found");
  }

  // Block edit after any refund: marketplace rule — editing allowed only before any refund is processed
  const order = await Order.findById(review.orderId).select("orderStatus paymentStatus items.refunded items.refundedKeysCount").lean();
  if (!order) {
    throw new ApiError(404, "Order not found");
  }
  if (order.orderStatus === "REFUNDED" || order.paymentStatus === "refunded") {
    throw new ApiError(400, "You cannot edit a review after the order has been fully refunded.");
  }
  const hasAnyRefund = order.items?.some((item) => item.refunded === true || (item.refundedKeysCount || 0) > 0);
  if (hasAnyRefund) {
    throw new ApiError(400, "You cannot edit a review after a refund has been processed for this order.");
  }

  review.rating = rating;
  review.comment = trimmedComment;
  await review.save();

  await calculateAverageRating(review.productId);

  res
    .status(200)
    .json(new ApiResponse(200, review, "Review updated successfully"));
});


// Purpose: Deletes a review by the review owner and recalculates product rating
const deleteReview = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const userId = req.user._id;

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

// Purpose: Retrieves reviews with optional filtering by product, rating, and sorting
const getReviews = asyncHandler(async (req, res) => {
  const { page = 1, limit = 10, productId, rating, sortBy } = req.query;

  const matchStage = {
    isHidden: false,
    isInvalidated: { $ne: true }, // Exclude reviews from fully refunded orders (marketplace rule)
    $or: [
      { moderationStatus: 'approved' },
      { moderationStatus: { $exists: false } }, // For reviews created before moderation was added
      { moderationStatus: 'pending', isModerated: false }, // Show pending if not yet moderated
    ],
    ...(productId && { productId: new mongoose.Types.ObjectId(productId) }),
    ...(rating && { rating: Number(rating) }),
  };
  const ReviewAggragation = Review.aggregate([
    {
      $match: matchStage,
    },
    {
      $lookup: {
        from: "users",
        localField: "userId",
        foreignField: "_id",
        as: "user",
        pipeline: [
          { $project: { name: 1, email: 1, profileImage: 1 } },
        ],
      },
    },
    {
      $unwind: {
        path: "$user",
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $project: {
        productId: 1,
        userId: 1,
        orderId: 1,
        rating: 1,
        comment: 1,
        isVerifiedPurchase: 1,
        helpfulCount: 1,
        moderationStatus: 1,
        createdAt: 1,
        updatedAt: 1,
        "user.name": 1,
        "user.email": 1,
        "user.profileImage": 1,
      },
    },
  ]);

  const options = {
    page: Number(page),
    limit: Number(limit),
    sort: { ...(sortBy === "rating" ? { rating: -1 } : { createdAt: -1 }) },
  };

  const reviews = await Review.aggregatePaginate(ReviewAggragation, options);

  res
    .status(200)
    .json(new ApiResponse(200, reviews, "Reviews fetched successfully"));
});

// Purpose: Records a helpful vote on a review and updates the helpful count
const voteOnReview = asyncHandler(async (req, res) => {
  const { reviewId } = req.params;
  const userId = req.user._id;
  const { isHelpful } = req.body;

  if (!mongoose.Types.ObjectId.isValid(reviewId)) {
    throw new ApiError(400, "Invalid review ID");
  }

  if (typeof isHelpful !== "boolean") {
    throw new ApiError(400, "isHelpful must be a boolean");
  }

  const review = await Review.findById(reviewId);

  if (!review) {
    throw new ApiError(404, "Review not found");
  }

  const existingVote = await ReviewVote.findOne({ reviewId, userId });

  if (existingVote) {
    existingVote.isHelpful = isHelpful;
    await existingVote.save();
  } else {
    await ReviewVote.create({ reviewId, userId, isHelpful });
  }

  const helpfulCount = await ReviewVote.countDocuments({
    reviewId,
    isHelpful: true,
  });

  review.helpfulCount = helpfulCount;
  await review.save();

  return res.status(200).json(
    new ApiResponse(200, { helpfulCount }, "Vote recorded successfully")
  );
});

// Purpose: Adds a reply to a review by the product seller or admin
const replyToReview = asyncHandler(async (req, res) => {
  const { reviewId } = req.params;
  const userId = req.user._id;
  const { replyText } = req.body;

  if (!replyText || replyText.trim() === "") {
    throw new ApiError(400, "Reply text is required");
  }

  if (!mongoose.Types.ObjectId.isValid(reviewId)) {
    throw new ApiError(400, "Invalid review ID");
  }

  const review = await Review.findById(reviewId).populate("productId");

  if (!review) {
    throw new ApiError(404, "Review not found");
  }

  const seller = await Seller.findOne({ userId });
  const isSeller = seller && review.productId.sellerId.toString() === seller._id.toString();
  const isAdmin = req.user.roles?.includes("admin");

  if (!isSeller && !isAdmin) {
    throw new ApiError(403, "Only the product seller or admin can reply to reviews");
  }

  const reply = await ReviewReply.create({
    reviewId,
    userId,
    replyText,
    isSellerReply: isSeller,
  });

  return res.status(201).json(
    new ApiResponse(201, reply, "Reply added successfully")
  );
});

// Purpose: Retrieves all replies for a specific review
const getReviewReplies = asyncHandler(async (req, res) => {
  const { reviewId } = req.params;

  if (!mongoose.Types.ObjectId.isValid(reviewId)) {
    throw new ApiError(400, "Invalid review ID");
  }

  const replies = await ReviewReply.find({ reviewId })
    .populate("userId", "name profileImage")
    .sort({ createdAt: 1 });

  return res.status(200).json(
    new ApiResponse(200, replies, "Replies retrieved successfully")
  );
});

// Purpose: Adds a photo to a review with image upload
const addReviewPhoto = asyncHandler(async (req, res) => {
  const { reviewId } = req.params;
  const userId = req.user._id;

  if (!req.file) {
    throw new ApiError(400, "Photo is required");
  }

  if (!mongoose.Types.ObjectId.isValid(reviewId)) {
    throw new ApiError(400, "Invalid review ID");
  }

  const review = await Review.findById(reviewId);

  if (!review) {
    throw new ApiError(404, "Review not found");
  }

  if (review.userId.toString() !== userId.toString()) {
    throw new ApiError(403, "You can only add photos to your own review");
  }

  const uploadResult = await fileUploader(req.file.path);

  const photo = await ReviewPhoto.create({
    reviewId,
    imageUrl: uploadResult.url,
    thumbnailUrl: uploadResult.url,
  });

  return res.status(201).json(
    new ApiResponse(201, photo, "Photo added successfully")
  );
});

// Purpose: Retrieves all photos associated with a review
const getReviewPhotos = asyncHandler(async (req, res) => {
  const { reviewId } = req.params;

  if (!mongoose.Types.ObjectId.isValid(reviewId)) {
    throw new ApiError(400, "Invalid review ID");
  }

  const photos = await ReviewPhoto.find({ reviewId }).sort({ order: 1 }).lean();

  return res.status(200).json(
    new ApiResponse(200, photos, "Photos retrieved successfully")
  );
});

// Purpose: Moderates a review by approving, rejecting, or hiding it (admin only)
const moderateReview = asyncHandler(async (req, res) => {
  const { reviewId } = req.params;
  const { action, reason } = req.body;

  if (!req.user.roles?.includes("admin")) {
    throw new ApiError(403, "Only admins can moderate reviews");
  }

  if (!mongoose.Types.ObjectId.isValid(reviewId)) {
    throw new ApiError(400, "Invalid review ID");
  }

  const review = await Review.findById(reviewId);

  if (!review) {
    throw new ApiError(404, "Review not found");
  }

  if (action === "approve") {
    review.isModerated = true;
    review.moderationStatus = "approved";
  } else if (action === "reject") {
    review.isModerated = true;
    review.moderationStatus = "rejected";
    review.moderationReason = reason;
  } else if (action === "hide") {
    review.isHidden = true;
    review.moderationReason = reason;
  }

  await review.save();

  return res.status(200).json(
    new ApiResponse(200, review, "Review moderated successfully")
  );
});

export { 
  createReview, 
  updateReview, 
  deleteReview, 
  getReviews,
  voteOnReview,
  replyToReview,
  getReviewReplies,
  addReviewPhoto,
  getReviewPhotos,
  moderateReview,
};
