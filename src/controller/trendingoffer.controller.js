import mongoose from "mongoose";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { TrendingOffer } from "../models/trendingoffer.model.js";
import { Product } from "../models/product.model.js";
import {
  getActiveTrendingOffers,
  getTrendingOfferForProduct,
  validateOfferDates,
  checkOverlappingProductOffers,
  updateOfferStatus,
  updateAllOfferStatuses,
} from "../services/trendingoffer.service.js";

const createTrendingOffer = asyncHandler(async (req, res) => {
  const { products, discountPercent, startTime, endTime } = req.body;

  if (!products || !Array.isArray(products) || products.length === 0) {
    throw new ApiError(400, "At least one product is required");
  }

  if (!discountPercent || discountPercent < 0 || discountPercent > 100) {
    throw new ApiError(400, "Discount percent must be between 0 and 100");
  }

  if (!startTime || !endTime) {
    throw new ApiError(400, "Start time and end time are required");
  }

  const validProductIds = products.filter(id => mongoose.Types.ObjectId.isValid(id));
  if (validProductIds.length !== products.length) {
    throw new ApiError(400, "Invalid product ID(s) provided");
  }

  const existingProducts = await Product.find({
    _id: { $in: validProductIds.map(id => new mongoose.Types.ObjectId(id)) },
    status: { $in: ['active', 'approved'] },
  });

  if (existingProducts.length !== validProductIds.length) {
    throw new ApiError(404, "One or more products not found or not active");
  }

  const dateValidation = validateOfferDates(startTime, endTime);
  if (!dateValidation.valid) {
    throw new ApiError(400, dateValidation.error);
  }

  const hasOverlap = await checkOverlappingProductOffers(validProductIds, startTime, endTime);
  if (hasOverlap) {
    throw new ApiError(400, "One or more products already have an active trending offer in this date range");
  }

  const now = new Date();
  let status = 'scheduled';
  if (new Date(startTime) <= now && new Date(endTime) >= now) {
    status = 'active';
  } else if (new Date(endTime) < now) {
    status = 'expired';
  }

  const offer = await TrendingOffer.create({
    products: validProductIds.map(id => new mongoose.Types.ObjectId(id)),
    discountPercent: parseFloat(discountPercent),
    startTime: new Date(startTime),
    endTime: new Date(endTime),
    status,
  });

  const populated = await TrendingOffer.findById(offer._id)
    .populate("products", "name price images slug");

  return res.status(201).json(
    new ApiResponse(201, populated, "Trending offer created successfully")
  );
});

const getTrendingOffers = asyncHandler(async (req, res) => {
  const offers = await getActiveTrendingOffers();

  return res.status(200).json(
    new ApiResponse(200, offers, "Trending offers retrieved successfully")
  );
});

const getTrendingOfferById = asyncHandler(async (req, res) => {
  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new ApiError(400, "Invalid trending offer ID");
  }

  const offer = await TrendingOffer.findById(id)
    .populate("products", "name price images slug description");

  if (!offer) {
    throw new ApiError(404, "Trending offer not found");
  }

  return res.status(200).json(
    new ApiResponse(200, offer, "Trending offer retrieved successfully")
  );
});

const getOfferByProduct = asyncHandler(async (req, res) => {
  const { productId } = req.params;

  if (!mongoose.Types.ObjectId.isValid(productId)) {
    throw new ApiError(400, "Invalid product ID");
  }

  const offer = await getTrendingOfferForProduct(productId);

  if (!offer) {
    return res.status(200).json(
      new ApiResponse(200, null, "No active trending offer for this product")
    );
  }

  const populated = await TrendingOffer.findById(offer._id)
    .populate("products", "name price images slug");

  return res.status(200).json(
    new ApiResponse(200, populated, "Trending offer retrieved successfully")
  );
});

const updateTrendingOffer = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { products, discountPercent, startTime, endTime, status } = req.body;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new ApiError(400, "Invalid trending offer ID");
  }

  const offer = await TrendingOffer.findById(id);
  if (!offer) {
    throw new ApiError(404, "Trending offer not found");
  }

  if (products !== undefined) {
    if (!Array.isArray(products) || products.length === 0) {
      throw new ApiError(400, "At least one product is required");
    }

    const validProductIds = products.filter(productId => mongoose.Types.ObjectId.isValid(productId));
    if (validProductIds.length !== products.length) {
      throw new ApiError(400, "Invalid product ID(s) provided");
    }

    const existingProducts = await Product.find({
      _id: { $in: validProductIds.map(id => new mongoose.Types.ObjectId(id)) },
      status: { $in: ['active', 'approved'] },
    });

    if (existingProducts.length !== validProductIds.length) {
      throw new ApiError(404, "One or more products not found or not active");
    }

    offer.products = validProductIds.map(id => new mongoose.Types.ObjectId(id));
  }

  if (discountPercent !== undefined) {
    if (discountPercent < 0 || discountPercent > 100) {
      throw new ApiError(400, "Discount percent must be between 0 and 100");
    }
    offer.discountPercent = parseFloat(discountPercent);
  }

  if (startTime || endTime) {
    const newStartTime = startTime ? new Date(startTime) : offer.startTime;
    const newEndTime = endTime ? new Date(endTime) : offer.endTime;

    const dateValidation = validateOfferDates(newStartTime, newEndTime);
    if (!dateValidation.valid) {
      throw new ApiError(400, dateValidation.error);
    }

    const productIds = offer.products.map(p => p.toString());
    const hasOverlap = await checkOverlappingProductOffers(
      productIds,
      newStartTime,
      newEndTime,
      id
    );
    if (hasOverlap) {
      throw new ApiError(400, "One or more products already have an active trending offer in this date range");
    }

    offer.startTime = newStartTime;
    offer.endTime = newEndTime;
  }

  if (status !== undefined) {
    if (!['active', 'expired', 'scheduled'].includes(status)) {
      throw new ApiError(400, "Invalid status. Must be one of: active, expired, scheduled");
    }
    offer.status = status;
  } else {
    await updateOfferStatus(offer._id);
    await offer.populate('products');
  }

  await offer.save();
  await offer.populate("products", "name price images slug");

  return res.status(200).json(
    new ApiResponse(200, offer, "Trending offer updated successfully")
  );
});

const deleteTrendingOffer = asyncHandler(async (req, res) => {
  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new ApiError(400, "Invalid trending offer ID");
  }

  const offer = await TrendingOffer.findById(id);
  if (!offer) {
    throw new ApiError(404, "Trending offer not found");
  }

  await offer.deleteOne();

  return res.status(200).json(
    new ApiResponse(200, null, "Trending offer deleted successfully")
  );
});

const getAllTrendingOffers = asyncHandler(async (req, res) => {
  const { page = 1, limit = 10, status } = req.query;

  const match = {};
  if (status !== undefined) {
    match.status = status;
  }

  const skip = (parseInt(page) - 1) * parseInt(limit);

  const offers = await TrendingOffer.find(match)
    .populate("products", "name price images slug")
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(parseInt(limit));

  const total = await TrendingOffer.countDocuments(match);

  return res.status(200).json(
    new ApiResponse(200, {
      offers,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit)),
      },
    }, "Trending offers retrieved successfully")
  );
});

const updateAllStatuses = asyncHandler(async (req, res) => {
  await updateAllOfferStatuses();

  return res.status(200).json(
    new ApiResponse(200, null, "All offer statuses updated successfully")
  );
});

export {
  createTrendingOffer,
  getTrendingOffers,
  getTrendingOfferById,
  getOfferByProduct,
  updateTrendingOffer,
  deleteTrendingOffer,
  getAllTrendingOffers,
  updateAllStatuses,
};

