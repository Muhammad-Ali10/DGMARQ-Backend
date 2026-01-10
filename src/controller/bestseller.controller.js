import mongoose from "mongoose";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import {
  getHomePageBestSellers,
  getPaginatedBestSellers,
  generateBestSellers,
} from "../services/bestseller.service.js";
import { BestSeller } from "../models/bestseller.model.js";

/**
 * Get bestsellers - optimized for home page (6 products) or paginated list
 */
const getBestsellers = asyncHandler(async (req, res) => {
  const { page, limit = 12, forHome = "false" } = req.query;

  // For home page: return only 6 products
  if (forHome === "true") {
    const bestsellers = await getHomePageBestSellers();
    
    // Filter out any null products (inactive products won't populate)
    const validBestsellers = bestsellers.filter(
      (bs) => bs.productId && bs.sellerId
    );

    return res.status(200).json(
      new ApiResponse(
        200,
        { bestsellers: validBestsellers },
        "Bestsellers retrieved successfully"
      )
    );
  }

  // For best sellers page: return paginated results
  const pageNum = parseInt(page) || 1;
  const limitNum = parseInt(limit) || 12;

  if (pageNum < 1 || limitNum < 1) {
    throw new ApiError(400, "Invalid pagination parameters");
  }

  const result = await getPaginatedBestSellers(pageNum, limitNum);

  return res.status(200).json(
    new ApiResponse(200, result, "Bestsellers retrieved successfully")
  );
});

/**
 * Get bestseller by product ID
 */
const getBestsellerByProduct = asyncHandler(async (req, res) => {
  const { productId } = req.params;

  if (!mongoose.Types.ObjectId.isValid(productId)) {
    throw new ApiError(400, "Invalid product ID");
  }

  const bestseller = await BestSeller.findOne({ productId })
    .populate({
      path: "productId",
      select: "name images price discount stock averageRating reviewCount region platform",
      populate: [
        {
          path: "region",
          select: "name",
        },
        {
          path: "platform",
          select: "name",
        },
      ],
    })
    .populate("sellerId", "shopName shopLogo");

  if (!bestseller) {
    throw new ApiError(404, "Product not found in bestsellers");
  }

  return res.status(200).json(
    new ApiResponse(200, bestseller, "Bestseller retrieved successfully")
  );
});

/**
 * Manually trigger best seller generation (admin only - for initial setup/testing)
 * Note: This is NOT for manual selection, only for triggering auto-generation
 */
const triggerBestSellerGeneration = asyncHandler(async (req, res) => {
  if (!req.user?.roles?.includes("admin")) {
    throw new ApiError(403, "Only admins can trigger best seller generation");
  }

  const result = await generateBestSellers();

  if (result.success) {
    return res.status(200).json(
      new ApiResponse(
        200,
        {
          count: result.count,
          generatedAt: result.generatedAt,
        },
        "Best sellers generated successfully"
      )
    );
  } else {
    return res.status(200).json(
      new ApiResponse(
        200,
        { message: result.message },
        "Best seller generation completed with message"
      )
    );
  }
});

export { getBestsellers, getBestsellerByProduct, triggerBestSellerGeneration };

