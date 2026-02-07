import mongoose from "mongoose";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { Wishlist } from "../models/wishlist.model.js";

// Purpose: Adds a product to the user's wishlist
const addToWishlist = asyncHandler(async (req, res) => {
  const { productId } = req.body;
  const userId = req.user._id;

  if (!productId) {
    throw new ApiError(400, "Missing required fields");
  }

  if (!mongoose.Types.ObjectId.isValid(productId)) {
    throw new ApiError(400, "Invalid productId");
  }

  const existingWishlist = await Wishlist.findOne({ userId, "products.productId": productId });

  if (existingWishlist) {
    throw new ApiError(400, "Product already exists in wishlist");
  }


  const updatedWishlist = await Wishlist.findOneAndUpdate(
    { userId },
    { $addToSet: { products: { productId } } },
    { upsert: true, new: true }
  ).populate("products.productId");

  res
    .status(201)
    .json(new ApiResponse(201, updatedWishlist, "Product added to wishlist"));
});



// Purpose: Retrieves the user's wishlist with populated product details
const getWishlist = asyncHandler(async (req, res) => {
  const userId = req.user._id;

  const wishlist = await Wishlist.findOne({ userId }).populate("products.productId", "name images price slug").lean();

  if (!wishlist || !wishlist.products || wishlist.products.length === 0) {
    return res
      .status(200)
      .json(new ApiResponse(200, { products: [] }, "Wishlist is empty"));
  }

  const validProducts = wishlist.products.filter(item => item.productId !== null && item.productId !== undefined);

  res
    .status(200)
    .json(new ApiResponse(200, { ...wishlist, products: validProducts }, "Wishlist fetched successfully"));
});

// Purpose: Removes a product from the user's wishlist
const removeFromWishlist = asyncHandler(async (req, res) => {
  const { productId } = req.body;
  const userId = req.user._id;

  if (!productId) {
    throw new ApiError(400, "Missing required fields");
  }

  if (!mongoose.Types.ObjectId.isValid(productId)) {
    throw new ApiError(400, "Invalid productId");
  }

  const updatedWishlist = await Wishlist.findOneAndUpdate(
    { userId },
    { $pull: { products: { productId } } },
    { new: true }
  ).populate("products.productId");

  if (!updatedWishlist) {
    throw new ApiError(404, "Wishlist not found");
  }

  res
    .status(200)
    .json(new ApiResponse(200, updatedWishlist.products, "Product removed from wishlist"));
});

// Purpose: Clears all products from the user's wishlist
const clearWishlist = asyncHandler(async (req, res) => {
  const userId = req.user._id;

  const clearedWishlist = await Wishlist.findOneAndUpdate(
    { userId },
    { $set: { products: [] } },
    { new: true }
  );

  if (!clearedWishlist) {
    throw new ApiError(404, "Wishlist not found");
  }

  res
    .status(200)
    .json(new ApiResponse(200, clearedWishlist.products, "Wishlist cleared successfully"));
});

export { addToWishlist, getWishlist, removeFromWishlist, clearWishlist };
