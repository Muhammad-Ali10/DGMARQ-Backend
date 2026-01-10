import { TrendingOffer } from '../models/trendingoffer.model.js';
import { Product } from '../models/product.model.js';
import { ApiError } from '../utils/ApiError.js';
import mongoose from 'mongoose';

/**
 * Get active trending offers
 */
export const getActiveTrendingOffers = async () => {
  const now = new Date();
  return await TrendingOffer.find({
    status: 'active',
    startTime: { $lte: now },
    endTime: { $gte: now },
  })
    .populate('products', 'name price images slug')
    .sort({ createdAt: -1 });
};

/**
 * Get trending offer for a specific product
 */
export const getTrendingOfferForProduct = async (productId) => {
  const now = new Date();
  return await TrendingOffer.findOne({
    products: new mongoose.Types.ObjectId(productId),
    status: 'active',
    startTime: { $lte: now },
    endTime: { $gte: now },
  });
};

/**
 * Calculate trending offer discount for a product
 */
export const calculateTrendingOfferDiscount = async (productId, originalPrice) => {
  const offer = await getTrendingOfferForProduct(productId);
  if (!offer) {
    return {
      originalPrice,
      discountedPrice: originalPrice,
      hasOffer: false,
    };
  }

  const discountAmount = (originalPrice * offer.discountPercent) / 100;
  const discountedPrice = Math.max(0, originalPrice - discountAmount);

  return {
    originalPrice,
    discountedPrice,
    hasOffer: true,
    discountPercent: offer.discountPercent,
    discountAmount,
    offerId: offer._id,
  };
};

/**
 * Validate offer dates and times
 */
export const validateOfferDates = (startTime, endTime) => {
  const start = new Date(startTime);
  const end = new Date(endTime);
  const now = new Date();

  if (start >= end) {
    return { valid: false, error: 'End time must be after start time' };
  }

  if (end < now) {
    return { valid: false, error: 'End time cannot be in the past' };
  }

  return { valid: true };
};

/**
 * Check for overlapping active offers on products
 * Ensures products can only belong to one active trending offer at a time
 */
export const checkOverlappingProductOffers = async (productIds, startTime, endTime, excludeId = null) => {
  const query = {
    products: { $in: productIds.map(id => new mongoose.Types.ObjectId(id)) },
    status: { $in: ['active', 'scheduled'] },
    $or: [
      {
        startTime: { $lte: new Date(endTime) },
        endTime: { $gte: new Date(startTime) },
      },
    ],
  };

  if (excludeId) {
    query._id = { $ne: new mongoose.Types.ObjectId(excludeId) };
  }

  const overlapping = await TrendingOffer.findOne(query);
  return !!overlapping;
};

/**
 * Update offer status based on current time
 * Automatically marks offers as expired after endTime
 */
export const updateOfferStatus = async (offerId) => {
  const offer = await TrendingOffer.findById(offerId);
  if (!offer) {
    return;
  }

  const now = new Date();

  if (now < offer.startTime) {
    offer.status = 'scheduled';
  } else if (now >= offer.startTime && now <= offer.endTime) {
    offer.status = 'active';
  } else if (now > offer.endTime) {
    offer.status = 'expired';
  }

  await offer.save();
  return offer;
};

/**
 * Batch update all offer statuses
 * Should be called periodically (e.g., via cron job)
 */
export const updateAllOfferStatuses = async () => {
  const now = new Date();
  
  // Mark expired offers
  await TrendingOffer.updateMany(
    {
      endTime: { $lt: now },
      status: { $ne: 'expired' },
    },
    {
      $set: { status: 'expired' },
    }
  );

  // Mark active offers
  await TrendingOffer.updateMany(
    {
      startTime: { $lte: now },
      endTime: { $gte: now },
      status: { $ne: 'active' },
    },
    {
      $set: { status: 'active' },
    }
  );

  // Mark scheduled offers
  await TrendingOffer.updateMany(
    {
      startTime: { $gt: now },
      status: { $ne: 'scheduled' },
    },
    {
      $set: { status: 'scheduled' },
    }
  );
};

