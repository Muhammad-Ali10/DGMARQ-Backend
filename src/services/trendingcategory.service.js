import { TrendingCategory } from '../models/trendingcategory.model.js';
import { Category } from '../models/category.model.js';
import { Product } from '../models/product.model.js';
import { Order } from '../models/order.model.js';
import { ApiError } from '../utils/ApiError.js';
import mongoose from 'mongoose';

export const getTrendingCategories = async (limit = 6) => {
  const now = new Date();
  const currentMonth = now.getMonth() + 1;
  const currentYear = now.getFullYear();

  const trendingCategories = await TrendingCategory.find({
    month: currentMonth,
    year: currentYear,
    totalSales: { $gt: 0 } // Only categories with sales
  })
    .populate('categoryId', 'name slug image description')
    .sort({ totalSales: -1 })
    .limit(limit);

  const validCategories = trendingCategories.filter(tc => 
    tc.categoryId && tc.categoryId.isActive !== false
  );

  return validCategories;
};

export const updateTrendingCategories = async () => {
  const now = new Date();
  const currentMonth = now.getMonth() + 1;
  const currentYear = now.getFullYear();

  const startOfMonth = new Date(currentYear, currentMonth - 1, 1);
  const endOfMonth = new Date(currentYear, currentMonth, 0, 23, 59, 59, 999);

  const categorySales = await Order.aggregate([
    {
      $match: {
        createdAt: { $gte: startOfMonth, $lte: endOfMonth },
        paymentStatus: 'paid',
        orderStatus: { $in: ['completed', 'processing'] }
      }
    },
    {
      $unwind: '$items'
    },
    {
      $lookup: {
        from: 'products',
        localField: 'items.productId',
        foreignField: '_id',
        as: 'product'
      }
    },
    {
      $unwind: '$product'
    },
    {
      $match: {
        'product.status': 'active',
        'product.categoryId': { $exists: true, $ne: null }
      }
    },
    {
      $group: {
        _id: '$product.categoryId',
        totalSales: { $sum: '$items.qty' },
        totalRevenue: { $sum: '$items.lineTotal' }
      }
    },
    {
      $match: {
        totalSales: { $gt: 0 }
      }
    },
    {
      $sort: { totalSales: -1 }
    }
  ]);

  await TrendingCategory.deleteMany({
    month: currentMonth,
    year: currentYear
  });

  const updatePromises = categorySales.map(async (categoryData) => {
    const categoryId = categoryData._id;
    
    const category = await Category.findById(categoryId);
    if (!category || !category.isActive) {
      return null;
    }

    return await TrendingCategory.findOneAndUpdate(
      { categoryId },
      {
        categoryId,
        totalSales: categoryData.totalSales,
        totalRevenue: categoryData.totalRevenue,
        month: currentMonth,
        year: currentYear,
        generatedAt: now
      },
      { upsert: true, new: true }
    );
  });

  const results = await Promise.all(updatePromises);
  const validResults = results.filter(r => r !== null);

  return {
    updated: validResults.length,
    month: currentMonth,
    year: currentYear,
    generatedAt: now
  };
};

