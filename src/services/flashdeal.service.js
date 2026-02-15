import { FlashDeal } from '../models/flashdeal.model.js';
import { Product } from '../models/product.model.js';
import { ApiError } from '../utils/ApiError.js';
import mongoose from 'mongoose';

export const getActiveFlashDeals = async () => {
  const now = new Date();
  return await FlashDeal.find({
    isActive: true,
    endDate: { $gte: now },
  })
    .populate('productId', 'name slug price images stock availableKeysCount')
    .sort({ startDate: 1, createdAt: -1 });
};

export const getProductFlashDeal = async (productId) => {
  const now = new Date();
  return await FlashDeal.findOne({
    productId: new mongoose.Types.ObjectId(productId),
    isActive: true,
    startDate: { $lte: now },
    endDate: { $gte: now },
  }).populate('productId');
};

export const calculateFlashDealPrice = async (productId, originalPrice) => {
  const flashDeal = await getProductFlashDeal(productId);
  if (!flashDeal) {
    return {
      originalPrice,
      discountedPrice: originalPrice,
      hasFlashDeal: false,
    };
  }

  const discountAmount = (originalPrice * flashDeal.discountPercentage) / 100;
  const discountedPrice = originalPrice - discountAmount;

  return {
    originalPrice,
    discountedPrice,
    hasFlashDeal: true,
    discountPercentage: flashDeal.discountPercentage,
    discountAmount,
    flashDealId: flashDeal._id,
  };
};

export const validateFlashDealDates = (startDate, endDate) => {
  const start = new Date(startDate);
  const end = new Date(endDate);
  const now = new Date();

  if (start >= end) {
    return { valid: false, error: 'End date must be after start date' };
  }

  if (end < now) {
    return { valid: false, error: 'End date cannot be in the past' };
  }

  return { valid: true };
};

export const checkOverlappingFlashDeals = async (productId, startDate, endDate, excludeId = null) => {
  const query = {
    productId: new mongoose.Types.ObjectId(productId),
    isActive: true,
    $or: [
      {
        startDate: { $lte: new Date(endDate) },
        endDate: { $gte: new Date(startDate) },
      },
    ],
  };

  if (excludeId) {
    query._id = { $ne: new mongoose.Types.ObjectId(excludeId) };
  }

  const overlapping = await FlashDeal.findOne(query);
  return !!overlapping;
};

