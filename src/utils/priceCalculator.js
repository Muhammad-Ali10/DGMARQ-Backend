import { calculateFlashDealPrice } from '../services/flashdeal.service.js';
import { calculateTrendingOfferDiscount } from '../services/trendingoffer.service.js';

export const calculateProductPrice = async (product) => {
  const originalPrice = product.price || 0;
  let discountedPrice = originalPrice;
  let discountAmount = 0;
  let discountPercentage = 0;
  let discountType = null;
  let discountSource = null;

  const flashDealPricing = await calculateFlashDealPrice(product._id || product, originalPrice);
  if (flashDealPricing.hasFlashDeal) {
    discountedPrice = flashDealPricing.discountedPrice;
    discountAmount = flashDealPricing.discountAmount;
    discountPercentage = flashDealPricing.discountPercentage;
    discountType = 'flash_deal';
    discountSource = flashDealPricing.flashDealId;
  } else {
    const trendingOfferPricing = await calculateTrendingOfferDiscount(product._id || product, originalPrice);
    if (trendingOfferPricing.hasOffer) {
      discountedPrice = trendingOfferPricing.discountedPrice;
      discountAmount = trendingOfferPricing.discountAmount;
      discountPercentage = trendingOfferPricing.discountPercent;
      discountType = 'trending_offer';
      discountSource = trendingOfferPricing.offerId;
    } else {
      const productDiscount = product.discount || 0;
      if (productDiscount > 0 && productDiscount <= 100) {
        discountAmount = (originalPrice * productDiscount) / 100;
        discountedPrice = Math.max(0, originalPrice - discountAmount);
        discountPercentage = productDiscount;
        discountType = 'product_discount';
        discountSource = product._id;
      }
    }
  }

  discountedPrice = Math.max(0, discountedPrice);

  return {
    originalPrice,
    discountedPrice,
    discountAmount,
    discountPercentage,
    discountType,
    discountSource,
    hasDiscount: discountAmount > 0,
  };
};

export const calculateLineTotal = (unitPrice, qty) => {
  return (unitPrice || 0) * (qty || 0);
};
