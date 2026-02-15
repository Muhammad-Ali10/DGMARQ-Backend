import mongoose from "mongoose";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { TrendingCategory } from "../models/trendingcategory.model.js";
import { Category } from "../models/category.model.js";
import { getTrendingCategories, updateTrendingCategories } from "../services/trendingcategory.service.js";

const getTrendingCategoriesHandler = asyncHandler(async (req, res) => {
  const { limit = 6 } = req.query;

  const categories = await getTrendingCategories(parseInt(limit));

  const formattedCategories = categories.map(tc => ({
    _id: tc._id,
    category: tc.categoryId,
    totalSales: tc.totalSales,
    totalRevenue: tc.totalRevenue,
    generatedAt: tc.generatedAt
  }));

  return res.status(200).json(
    new ApiResponse(200, formattedCategories, "Trending categories retrieved successfully")
  );
});

const getTrendingCategoryById = asyncHandler(async (req, res) => {
  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new ApiError(400, "Invalid trending category ID");
  }

  const trending = await TrendingCategory.findById(id)
    .populate("categoryId", "name slug image description");

  if (!trending) {
    throw new ApiError(404, "Trending category not found");
  }

  return res.status(200).json(
    new ApiResponse(200, trending, "Trending category retrieved successfully")
  );
});

const updateTrendingCategoriesHandler = asyncHandler(async (req, res) => {
  const result = await updateTrendingCategories();

  return res.status(200).json(
    new ApiResponse(200, result, "Trending categories recalculated successfully based on sales data")
  );
});

const getAllTrendingCategories = asyncHandler(async (req, res) => {
  const { page = 1, limit = 10 } = req.query;

  const skip = (parseInt(page) - 1) * parseInt(limit);

  const categories = await TrendingCategory.find()
    .populate("categoryId", "name slug image")
    .sort({ rankingScore: -1 })
    .skip(skip)
    .limit(parseInt(limit));

  const total = await TrendingCategory.countDocuments();

  return res.status(200).json(
    new ApiResponse(200, {
      categories,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit)),
      },
    }, "Trending categories retrieved successfully")
  );
});

export {
  getTrendingCategoriesHandler,
  getTrendingCategoryById,
  updateTrendingCategoriesHandler,
  getAllTrendingCategories,
};

