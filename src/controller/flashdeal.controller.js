import mongoose from "mongoose";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { FlashDeal } from "../models/flashdeal.model.js";
import { Product } from "../models/product.model.js";
import { Order } from "../models/order.model.js";
import {
  getActiveFlashDeals,
  getProductFlashDeal,
  validateFlashDealDates,
  checkOverlappingFlashDeals,
} from "../services/flashdeal.service.js";
import { upload } from "../middlerwares/multer.middlerware.js";
import { fileUploader } from "../utils/cloudinary.js";

/**
 * Create flash deal (admin only)
 * POST /api/v1/flash-deal
 */
const createFlashDeal = asyncHandler(async (req, res) => {
  const { productId, discountPercentage, startDate, endDate, banner } =
    req.body;

  if (!productId || !discountPercentage || !startDate || !endDate) {
    throw new ApiError(
      400,
      "Missing required fields: productId, discountPercentage, startDate, endDate"
    );
  }

  if (!mongoose.Types.ObjectId.isValid(productId)) {
    throw new ApiError(400, "Invalid product ID");
  }

  // Validate product exists and is approved/active
  const product = await Product.findById(productId);
  if (!product) {
    throw new ApiError(404, "Product not found");
  }

  // Check product status - must be approved/active
  if (!['active', 'approved'].includes(product.status)) {
    throw new ApiError(400, "Product must be approved and active to create a flash deal");
  }

  // Validate discount percentage
  if (discountPercentage < 1 || discountPercentage > 90) {
    throw new ApiError(400, "Discount percentage must be between 1 and 90");
  }

  // Validate dates
  const dateValidation = validateFlashDealDates(startDate, endDate);
  if (!dateValidation.valid) {
    throw new ApiError(400, dateValidation.error);
  }

  // Check for overlapping deals
  const hasOverlap = await checkOverlappingFlashDeals(
    productId,
    startDate,
    endDate
  );
  if (hasOverlap) {
    throw new ApiError(
      400,
      "Product already has an active flash deal in this date range"
    );
  }

  // Handle banner upload if provided
  let bannerUrl = banner;
  if (req.file) {
    const uploadResult = await fileUploader(req.file.path);
    bannerUrl = uploadResult.url;
  }

  const flashDeal = await FlashDeal.create({
    productId: new mongoose.Types.ObjectId(productId),
    discountPercentage,
    startDate: new Date(startDate),
    endDate: new Date(endDate),
    banner: bannerUrl,
    isActive: true,
  });

  const populated = await FlashDeal.findById(flashDeal._id).populate(
    "productId",
    "name slug price images"
  );

  return res
    .status(201)
    .json(new ApiResponse(201, populated, "Flash deal created successfully"));
});

/**
 * Calculate countdown timer from dates
 */
const calculateCountdown = (startDate, endDate) => {
  const now = new Date();
  const start = new Date(startDate);
  const end = new Date(endDate);

  let status = "Active";
  let targetDate = end;

  if (now < start) {
    status = "Coming Soon";
    targetDate = start;
  } else if (now > end) {
    status = "Ended";
    return {
      status,
      hours: 0,
      minutes: 0,
      seconds: 0,
    };
  }

  const diff = targetDate - now;
  const hours = Math.floor(diff / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  const seconds = Math.floor((diff % (1000 * 60)) / 1000);

  return {
    status,
    hours: Math.max(0, hours),
    minutes: Math.max(0, minutes),
    seconds: Math.max(0, seconds),
  };
};

/**
 * Get sold quantity for a product
 */
const getSoldQuantity = async (productId) => {
  const result = await Order.aggregate([
    {
      $match: {
        paymentStatus: "paid",
      },
    },
    {
      $unwind: "$items",
    },
    {
      $match: {
        "items.productId": new mongoose.Types.ObjectId(productId),
        "items.refunded": { $ne: true },
      },
    },
    {
      $group: {
        _id: null,
        totalSold: { $sum: "$items.qty" },
      },
    },
  ]);

  return result[0]?.totalSold || 0;
};

/**
 * Get all active flash deals (public)
 * GET /api/v1/flash-deal
 */
const getFlashDeals = asyncHandler(async (req, res) => {
  const deals = await getActiveFlashDeals();

  // Format deals for frontend
  const formattedDeals = await Promise.all(
    deals.map(async (deal) => {
      const product = deal.productId;
      if (!product) return null;

      // Calculate prices
      const actualPrice = product.price || 0;
      const discountAmount = (actualPrice * deal.discountPercentage) / 100;
      const discountPrice = actualPrice - discountAmount;

      // Calculate countdown
      const timeLeft = calculateCountdown(deal.startDate, deal.endDate);

      // Get sold quantity
      const sold = await getSoldQuantity(product._id);

      // Calculate left quantity
      const stock = product.availableKeysCount || product.stock || 0;
      const left = Math.max(0, stock - sold);

      return {
        _id: deal._id,
        id: product._id,
        title: product.name,
        image: deal.banner || product.images?.[0] || "",
        actualPrice: actualPrice.toFixed(2),
        discountPrice: discountPrice.toFixed(2),
        discountPercentage: deal.discountPercentage,
        timeLeft,
        left,
        sold,
        stock,
        gst: 0, // GST can be added later if needed
        startDate: deal.startDate,
        endDate: deal.endDate,
        isActive: deal.isActive,
      };
    })
  );

  // Filter out null values
  const validDeals = formattedDeals.filter((deal) => deal !== null);

  return res
    .status(200)
    .json(
      new ApiResponse(200, validDeals, "Flash deals retrieved successfully")
    );
});

/**
 * Get flash deal by ID
 * GET /api/v1/flash-deal/:id
 */
const getFlashDealById = asyncHandler(async (req, res) => {
  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new ApiError(400, "Invalid flash deal ID");
  }

  const deal = await FlashDeal.findById(id).populate(
    "productId",
    "name slug price images description"
  );

  if (!deal) {
    throw new ApiError(404, "Flash deal not found");
  }

  return res
    .status(200)
    .json(new ApiResponse(200, deal, "Flash deal retrieved successfully"));
});

/**
 * Update flash deal (admin only)
 * PATCH /api/v1/flash-deal/:id
 */
const updateFlashDeal = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const {
    productId,
    discountPercentage,
    startDate,
    endDate,
    banner,
    isActive,
  } = req.body;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new ApiError(400, "Invalid flash deal ID");
  }

  const flashDeal = await FlashDeal.findById(id);
  if (!flashDeal) {
    throw new ApiError(404, "Flash deal not found");
  }

  // Update fields
  if (discountPercentage !== undefined) {
    if (discountPercentage < 1 || discountPercentage > 90) {
      throw new ApiError(400, "Discount percentage must be between 1 and 90");
    }
    flashDeal.discountPercentage = discountPercentage;
  }

  if (startDate || endDate) {
    const newStartDate = startDate ? new Date(startDate) : flashDeal.startDate;
    const newEndDate = endDate ? new Date(endDate) : flashDeal.endDate;

    const dateValidation = validateFlashDealDates(newStartDate, newEndDate);
    if (!dateValidation.valid) {
      throw new ApiError(400, dateValidation.error);
    }

    // Check for overlapping deals (excluding current)
    const hasOverlap = await checkOverlappingFlashDeals(
      flashDeal.productId,
      newStartDate,
      newEndDate,
      id
    );
    if (hasOverlap) {
      throw new ApiError(
        400,
        "Product already has an active flash deal in this date range"
      );
    }

    flashDeal.startDate = newStartDate;
    flashDeal.endDate = newEndDate;
  }

  if (banner !== undefined) {
    flashDeal.banner = banner;
  }

  if (req.file) {
    const uploadResult = await fileUploader(req.file.path);
    flashDeal.banner = uploadResult.url;
  }

  if (isActive !== undefined) {
    flashDeal.isActive = isActive;
  }

  await flashDeal.save();

  const populated = await FlashDeal.findById(flashDeal._id).populate(
    "productId",
    "name slug price images"
  );

  return res
    .status(200)
    .json(new ApiResponse(200, populated, "Flash deal updated successfully"));
});

/**
 * Delete flash deal (admin only)
 * DELETE /api/v1/flash-deal/:id
 */
const deleteFlashDeal = asyncHandler(async (req, res) => {
  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new ApiError(400, "Invalid flash deal ID");
  }

  const flashDeal = await FlashDeal.findById(id);
  if (!flashDeal) {
    throw new ApiError(404, "Flash deal not found");
  }

  await flashDeal.deleteOne();

  return res
    .status(200)
    .json(new ApiResponse(200, null, "Flash deal deleted successfully"));
});

/**
 * Get all flash deals (admin only)
 * GET /api/v1/flash-deal/admin/all
 */
const getAllFlashDeals = asyncHandler(async (req, res) => {
  const { page = 1, limit = 20, isActive } = req.query;

  const match = {};
  if (isActive !== undefined) {
    match.isActive = isActive === "true";
  }

  const skip = (parseInt(page) - 1) * parseInt(limit);

  const deals = await FlashDeal.find(match)
    .populate("productId", "name slug price images")
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(parseInt(limit));

  const total = await FlashDeal.countDocuments(match);

  return res.status(200).json(
    new ApiResponse(
      200,
      {
        deals,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / parseInt(limit)),
        },
      },
      "Flash deals retrieved successfully"
    )
  );
});

export {
  createFlashDeal,
  getFlashDeals,
  getFlashDealById,
  updateFlashDeal,
  deleteFlashDeal,
  getAllFlashDeals,
};
