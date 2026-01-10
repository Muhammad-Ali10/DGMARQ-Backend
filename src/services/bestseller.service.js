import mongoose from "mongoose";
import { BestSeller } from "../models/bestseller.model.js";
import { Product } from "../models/product.model.js";
import { Review } from "../models/review.model.js";
import { Seller } from "../models/seller.model.js";
import { logger } from "../utils/logger.js";

/**
 * Calculate seller performance score based on reviews
 * Formula: (averageRating * 0.7) + (normalizedReviewCount * 0.3)
 * This gives weight to both rating quality and review volume
 */
const calculateSellerScore = (averageRating, reviewCount, maxReviewCount) => {
  const normalizedReviewCount = maxReviewCount > 0 
    ? Math.min(reviewCount / maxReviewCount, 1) 
    : 0;
  
  return (averageRating * 0.7) + (normalizedReviewCount * 0.3);
};

/**
 * Auto-generate best sellers based on seller review performance
 * Selects top 6 sellers and picks 1 best product from each
 */
export const generateBestSellers = async () => {
  try {
    // Step 1: Aggregate reviews per seller through products
    const sellerReviewStats = await Review.aggregate([
      {
        $lookup: {
          from: "products",
          localField: "productId",
          foreignField: "_id",
          as: "product",
        },
      },
      {
        $unwind: "$product",
      },
      {
        $match: {
          "product.status": { $in: ["active", "approved"] }, // Include both active and approved products
          isHidden: false,
          $or: [
            { moderationStatus: "approved" },
            { moderationStatus: { $exists: false } },
            { moderationStatus: "pending", isModerated: false },
          ],
        },
      },
      {
        $group: {
          _id: "$product.sellerId",
          averageRating: { $avg: "$rating" },
          reviewCount: { $sum: 1 },
          totalRating: { $sum: "$rating" },
        },
      },
      {
        $match: {
          reviewCount: { $gte: 1 }, // At least 1 review
        },
      },
    ]);

    if (sellerReviewStats.length === 0) {
      logger.warn("No seller review data found for best sellers generation");
      return { success: false, message: "No seller review data available" };
    }

    // Step 2: Find max review count for normalization
    const maxReviewCount = Math.max(
      ...sellerReviewStats.map((s) => s.reviewCount),
      1
    );

    // Step 3: Calculate scores and sort sellers
    const sellerScores = sellerReviewStats
      .map((seller) => ({
        sellerId: seller._id,
        averageRating: seller.averageRating || 0,
        reviewCount: seller.reviewCount,
        score: calculateSellerScore(
          seller.averageRating || 0,
          seller.reviewCount,
          maxReviewCount
        ),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 6); // Top 6 sellers

    // Step 4: Verify sellers are active
    const activeSellerIds = sellerScores.map((s) => s.sellerId);
    const activeSellers = await Seller.find({
      _id: { $in: activeSellerIds },
      status: "active",
    }).select("_id");

    const validSellerIds = new Set(
      activeSellers.map((s) => s._id.toString())
    );

    // Step 5: For each top seller, find their best product
    const bestSellerProducts = [];

    for (const sellerScore of sellerScores) {
      if (!validSellerIds.has(sellerScore.sellerId.toString())) {
        continue;
      }

      // Find the best product for this seller (highest rating, must be active/approved)
      const bestProduct = await Product.findOne({
        sellerId: sellerScore.sellerId,
        status: { $in: ["active", "approved"] }, // Include both active and approved products
        stock: { $gt: 0 }, // Must have stock
      })
        .sort({ averageRating: -1, reviewCount: -1 })
        .select("_id averageRating");

      if (bestProduct && bestProduct.averageRating > 0) {
        bestSellerProducts.push({
          sellerId: sellerScore.sellerId,
          productId: bestProduct._id,
          calculatedRating: bestProduct.averageRating,
        });
      }
    }

    if (bestSellerProducts.length === 0) {
      logger.warn("No valid products found for best sellers");
      return { success: false, message: "No valid products found" };
    }

    // Step 6: Clear old best sellers and insert new ones
    await BestSeller.deleteMany({});
    
    const bestSellerDocs = bestSellerProducts.map((bs) => ({
      sellerId: bs.sellerId,
      productId: bs.productId,
      calculatedRating: bs.calculatedRating,
      generatedAt: new Date(),
    }));

    await BestSeller.insertMany(bestSellerDocs);

    logger.success(
      `Best sellers generated successfully: ${bestSellerDocs.length} products`
    );

    return {
      success: true,
      count: bestSellerDocs.length,
      generatedAt: new Date(),
    };
  } catch (error) {
    logger.error("Error generating best sellers", error);
    throw error;
  }
};

/**
 * Get best sellers for home page (6 products)
 */
export const getHomePageBestSellers = async () => {
  return await BestSeller.find({})
    .populate({
      path: "productId",
      select: "name slug images price discount stock averageRating reviewCount status region platform",
      match: { status: { $in: ["active", "approved"] } }, // Include both active and approved products
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
    .populate({
      path: "sellerId",
      select: "shopName shopLogo status",
      match: { status: "active" },
    })
    .sort({ calculatedRating: -1 })
    .limit(6)
    .lean();
};

/**
 * Get paginated best sellers for best sellers page
 */
export const getPaginatedBestSellers = async (page = 1, limit = 12) => {
  const skip = (page - 1) * limit;

  const [bestsellers, total] = await Promise.all([
    BestSeller.find({})
      .populate({
        path: "productId",
        select: "name slug images price discount stock averageRating reviewCount status categoryId region platform",
        match: { status: { $in: ["active", "approved"] } }, // Include both active and approved products
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
      .populate({
        path: "sellerId",
        select: "shopName shopLogo status",
        match: { status: "active" },
      })
      .sort({ calculatedRating: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    BestSeller.countDocuments({}),
  ]);

  // Filter out any null products (inactive products won't populate)
  const validBestsellers = bestsellers.filter(
    (bs) => bs.productId && bs.sellerId
  );

  return {
    bestsellers: validBestsellers,
    pagination: {
      page,
      limit,
      total,
      pages: Math.ceil(total / limit),
    },
  };
};

