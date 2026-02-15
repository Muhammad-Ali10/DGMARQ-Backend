import { HomepageSlider } from '../models/homepageslider.model.js';
import { Product } from '../models/product.model.js';
import { ApiError } from '../utils/ApiError.js';
import mongoose from 'mongoose';

export const getActiveSliders = async () => {
  return await HomepageSlider.find({
    isActive: true,
  })
    .populate('productId', 'name slug price images')
    .sort({ slideIndex: 1, order: 1, createdAt: -1 })
    .lean();
};

export const validateSliderData = async (data) => {
  const { productId, link } = data;

  if (productId) {
    if (!mongoose.Types.ObjectId.isValid(productId)) {
      return { valid: false, error: 'Invalid product ID' };
    }

    const product = await Product.findById(productId)
      .select('_id name')
      .lean();
    if (!product) {
      return { valid: false, error: 'Product not found' };
    }
  }

  return { valid: true };
};

