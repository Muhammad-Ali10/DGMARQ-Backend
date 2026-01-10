import { TrendingCategory } from '../models/trendingcategory.model.js';
import { Category } from '../models/category.model.js';
import { Product } from '../models/product.model.js';
import { Order } from '../models/order.model.js';
import { ApiError } from '../utils/ApiError.js';
import mongoose from 'mongoose';

/**
 * Get trending categories (returns only precomputed data)
 * Only returns categories with sales > 0 in the current month
 */
export const getTrendingCategories = async (limit = 6) => {
  const now = new Date();
  const currentMonth = now.getMonth() + 1; // 1-12
  const currentYear = now.getFullYear();

  // Get trending categories for current month, sorted by totalSales descending
  const trendingCategories = await TrendingCategory.find({
    month: currentMonth,
    year: currentYear,
    totalSales: { $gt: 0 } // Only categories with sales
  })
    .populate('categoryId', 'name slug image description')
    .sort({ totalSales: -1 })
    .limit(limit);

  // Filter out any categories where the category itself is inactive or doesn't exist
  const validCategories = trendingCategories.filter(tc => 
    tc.categoryId && tc.categoryId.isActive !== false
  );

  return validCategories;
};

/**
 * Calculate and update trending categories based on REAL SALES DATA
 * This should be called monthly (via cron job)
 * 
 * Business Logic:
 * - Analyzes order items from the current month
 * - Groups sales by product category
 * - Calculates total quantity sold and total revenue per category
 * - Only includes categories with sales > 0
 * - Stores results for the current month
 */
export const updateTrendingCategories = async () => {
  const now = new Date();
  const currentMonth = now.getMonth() + 1; // 1-12
  const currentYear = now.getFullYear();

  // Calculate start and end of current month
  const startOfMonth = new Date(currentYear, currentMonth - 1, 1);
  const endOfMonth = new Date(currentYear, currentMonth, 0, 23, 59, 59, 999);

  // Aggregate sales data by category for the current month
  // Only consider completed or processing orders with paid status
  const categorySales = await Order.aggregate([
    {
      // Match orders from current month with successful payment
      $match: {
        createdAt: { $gte: startOfMonth, $lte: endOfMonth },
        paymentStatus: 'paid',
        orderStatus: { $in: ['completed', 'processing'] }
      }
    },
    {
      // Unwind order items
      $unwind: '$items'
    },
    {
      // Lookup product details
      $lookup: {
        from: 'products',
        localField: 'items.productId',
        foreignField: '_id',
        as: 'product'
      }
    },
    {
      // Unwind product (should be single product per item)
      $unwind: '$product'
    },
    {
      // Match only active products
      $match: {
        'product.status': 'active',
        'product.categoryId': { $exists: true, $ne: null }
      }
    },
    {
      // Group by category and calculate totals
      $group: {
        _id: '$product.categoryId',
        totalSales: { $sum: '$items.qty' }, // Total quantity sold
        totalRevenue: { $sum: '$items.lineTotal' } // Total revenue
      }
    },
    {
      // Filter out categories with zero sales
      $match: {
        totalSales: { $gt: 0 }
      }
    },
    {
      // Sort by total sales descending
      $sort: { totalSales: -1 }
    }
  ]);

  // Clear existing trending categories for current month (to remove categories with no sales)
  await TrendingCategory.deleteMany({
    month: currentMonth,
    year: currentYear
  });

  // Update or create trending category records
  const updatePromises = categorySales.map(async (categoryData) => {
    const categoryId = categoryData._id;
    
    // Verify category exists and is active
    const category = await Category.findById(categoryId);
    if (!category || !category.isActive) {
      return null; // Skip inactive or non-existent categories
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

