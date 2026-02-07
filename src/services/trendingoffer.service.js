import { TrendingOffer } from '../models/trendingoffer.model.js';
import { Product } from '../models/product.model.js';
import { ApiError } from '../utils/ApiError.js';
import mongoose from 'mongoose';

// Purpose: Retrieves active trending offers within current time period
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

// Purpose: Gets active trending offer for a specific product
export const getTrendingOfferForProduct = async (productId) => {
  const now = new Date();
  return await TrendingOffer.findOne({
    products: new mongoose.Types.ObjectId(productId),
    status: 'active',
    startTime: { $lte: now },
    endTime: { $gte: now },
  });
};

// Purpose: Calculates trending offer discount for a product
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

// Purpose: Validates offer start and end dates for correctness
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

// Purpose: Checks for overlapping active offers on products within a time range
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

// Purpose: Updates offer status based on current time
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

// Purpose: Batch updates all offer statuses based on current time
export const updateAllOfferStatuses = async () => {
  const now = new Date();
  
  await TrendingOffer.updateMany(
    {
      endTime: { $lt: now },
      status: { $ne: 'expired' },
    },
    {
      $set: { status: 'expired' },
    }
  );

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

