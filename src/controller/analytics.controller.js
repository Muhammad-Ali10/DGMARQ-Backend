import mongoose from "mongoose";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { Analytics } from "../models/analytics.model.js";
import { Product } from "../models/product.model.js";
import { Order } from "../models/order.model.js";
import { Wishlist } from "../models/wishlist.model.js";
import { Payout } from "../models/payout.model.js";
import { Seller } from "../models/seller.model.js";
import { Subscription } from "../models/subscription.model.js";
import { UserBehavior } from "../models/userBehavior.model.js";
import { User } from "../models/user.model.js";

// Retrieves product analytics with real-time sales and wishlist counts
const getProductAnalytics = asyncHandler(async (req, res) => {
  const { productId } = req.params;

  if (!mongoose.Types.ObjectId.isValid(productId)) {
    throw new ApiError(400, "Invalid product ID");
  }

  let analytics = await Analytics.findOne({ productId });

  if (!analytics) {
    analytics = await Analytics.create({
      productId,
      salesCount: 0,
      viewsCount: 0,
      wishlistCount: 0,
      lastUpdated: new Date(),
    });
  }

  const salesResult = await Order.aggregate([
    { $match: { paymentStatus: "paid" } },
    { $unwind: "$items" },
    { $match: { "items.productId": new mongoose.Types.ObjectId(productId) } },
    {
      $group: {
        _id: null,
        salesCount: { $sum: { $subtract: ["$items.qty", { $ifNull: ["$items.refundedKeysCount", 0] }] } },
      },
    },
  ]);
  const salesCount = salesResult[0]?.salesCount ?? 0;

  const wishlistCount = await Wishlist.countDocuments({
    "items.productId": productId,
  });

  analytics.salesCount = salesCount;
  analytics.wishlistCount = wishlistCount;
  analytics.lastUpdated = new Date();
  await analytics.save();

  return res.status(200).json(
    new ApiResponse(200, analytics, "Product analytics retrieved successfully")
  );
});

// Increments product view count in analytics
const incrementProductViews = asyncHandler(async (req, res) => {
  const { productId } = req.params;

  if (!mongoose.Types.ObjectId.isValid(productId)) {
    throw new ApiError(400, "Invalid product ID");
  }

  const analytics = await Analytics.findOneAndUpdate(
    { productId },
    {
      $inc: { viewsCount: 1 },
      $set: { lastUpdated: new Date() },
    },
    { upsert: true, new: true }
  );

  return res.status(200).json(
    new ApiResponse(200, analytics, "Product views incremented successfully")
  );
});

// Retrieves category analytics with calculated sales data
const getCategoryAnalytics = asyncHandler(async (req, res) => {
  const { categoryId } = req.params;

  if (!mongoose.Types.ObjectId.isValid(categoryId)) {
    throw new ApiError(400, "Invalid category ID");
  }

  const analytics = await Analytics.findOne({ categoryId });

  if (!analytics) {
  const categorySales = await Order.aggregate([
    {
      $match: {
        paymentStatus: "paid",
      },
    },
    {
      $unwind: "$items",
    },
    {
      $lookup: {
        from: "products",
        localField: "items.productId",
        foreignField: "_id",
        as: "product",
      },
    },
    {
      $unwind: "$product",
    },
    {
      $match: {
        "product.categoryId": new mongoose.Types.ObjectId(categoryId),
      },
    },
    {
      $group: {
        _id: null,
        total: { $sum: { $subtract: ["$items.qty", { $ifNull: ["$items.refundedKeysCount", 0] }] } },
      },
    },
  ]);

  const salesCount = categorySales[0]?.total || 0;

  const newAnalytics = await Analytics.create({
      categoryId,
      categorySalesCount: salesCount,
      lastUpdated: new Date(),
    });

    return res.status(200).json(
      new ApiResponse(200, newAnalytics, "Category analytics retrieved successfully")
    );
  }

  const categorySales = await Order.aggregate([
    {
      $match: {
        paymentStatus: "paid",
      },
    },
    {
      $unwind: "$items",
    },
    {
      $lookup: {
        from: "products",
        localField: "items.productId",
        foreignField: "_id",
        as: "product",
      },
    },
    {
      $unwind: "$product",
    },
    {
      $match: {
        "product.categoryId": new mongoose.Types.ObjectId(categoryId),
      },
    },
    {
      $group: {
        _id: null,
        total: { $sum: { $subtract: ["$items.qty", { $ifNull: ["$items.refundedKeysCount", 0] }] } },
      },
    },
  ]);

  analytics.categorySalesCount = categorySales[0]?.total || 0;
  analytics.lastUpdated = new Date();
  await analytics.save();

  return res.status(200).json(
    new ApiResponse(200, analytics, "Category analytics retrieved successfully")
  );
});

// Retrieves top products by sales for admin dashboard
const getTopProducts = asyncHandler(async (req, res) => {
  if (!req.user.roles?.includes("admin")) {
    throw new ApiError(403, "Only admins can view top products");
  }

  const { limit = 10 } = req.query;

  // Get top products from Analytics collection
  const analyticsProducts = await Analytics.find({ salesCount: { $gt: 0 } })
    .populate("productId", "name images price")
    .sort({ salesCount: -1 })
    .limit(parseInt(limit))
    .lean();

  // Also get top products from actual order data (non-refunded units and revenue only)
  const orderBasedProducts = await Order.aggregate([
    {
      $match: {
        paymentStatus: 'paid',
      },
    },
    {
      $unwind: '$items',
    },
    {
      $group: {
        _id: '$items.productId',
        salesCount: { $sum: { $subtract: ['$items.qty', { $ifNull: ['$items.refundedKeysCount', 0] }] } },
        revenue: { $sum: { $subtract: ['$items.lineTotal', { $ifNull: ['$items.refundedAmount', 0] }] } },
      },
    },
    {
      $lookup: {
        from: 'products',
        localField: '_id',
        foreignField: '_id',
        as: 'product',
      },
    },
    {
      $unwind: '$product',
    },
    {
      $project: {
        productId: '$_id',
        name: '$product.name',
        images: '$product.images',
        price: '$product.price',
        salesCount: 1,
        revenue: 1,
      },
    },
    {
      $sort: { salesCount: -1 },
    },
    {
      $limit: parseInt(limit),
    },
  ]);

  // Format response consistently
  const formattedProducts = orderBasedProducts.map((item) => ({
    _id: item.productId,
    productId: { _id: item.productId, name: item.name, images: item.images, price: item.price },
    name: item.name,
    sales: item.salesCount,
    salesCount: item.salesCount,
    revenue: item.revenue,
  }));

  return res.status(200).json(
    new ApiResponse(200, formattedProducts, "Top products retrieved successfully")
  );
});

// Retrieves analytics dashboard with aggregated metrics for admin
const getAnalyticsDashboard = asyncHandler(async (req, res) => {
  if (!req.user.roles?.includes("admin")) {
    throw new ApiError(403, "Only admins can view analytics dashboard");
  }

  const [
    totalSales,
    totalViews,
    totalWishlists,
    topProducts,
    categoryAnalytics,
  ] = await Promise.all([
    // Get sales count from actual orders (non-refunded units only)
    Order.aggregate([
      { $match: { paymentStatus: 'paid' } },
      { $unwind: '$items' },
      { $group: { _id: null, total: { $sum: { $subtract: ['$items.qty', { $ifNull: ['$items.refundedKeysCount', 0] }] } } } },
    ]),
    // Get views from Analytics collection
    Analytics.aggregate([
      { $group: { _id: null, total: { $sum: "$viewsCount" } } },
    ]),
    // Get wishlists from Analytics collection
    Analytics.aggregate([
      { $group: { _id: null, total: { $sum: "$wishlistCount" } } },
    ]),
    // Get top products from actual order data (non-refunded units only)
    Order.aggregate([
      {
        $match: {
          paymentStatus: 'paid',
        },
      },
      {
        $unwind: '$items',
      },
      {
        $group: {
          _id: '$items.productId',
          salesCount: { $sum: { $subtract: ['$items.qty', { $ifNull: ['$items.refundedKeysCount', 0] }] } },
        },
      },
      {
        $lookup: {
          from: 'products',
          localField: '_id',
          foreignField: '_id',
          as: 'product',
        },
      },
      {
        $unwind: '$product',
      },
      {
        $project: {
          productId: '$_id',
          name: '$product.name',
          images: '$product.images',
          salesCount: 1,
        },
      },
      {
        $sort: { salesCount: -1 },
      },
      {
        $limit: 10,
      },
    ]),
    Analytics.find({ categoryId: { $exists: true } })
      .populate("categoryId", "name")
      .sort({ categorySalesCount: -1 })
      .limit(10)
      .lean(),
  ]);

  return res.status(200).json(
    new ApiResponse(200, {
      totals: {
        sales: totalSales[0]?.total || 0,
        views: totalViews[0]?.total || 0,
        wishlists: totalWishlists[0]?.total || 0,
      },
      topProducts: topProducts.map(item => ({
        _id: item.productId,
        productId: { _id: item.productId, name: item.name, images: item.images },
        name: item.name,
        sales: item.salesCount,
        salesCount: item.salesCount,
      })),
      categoryAnalytics,
    }, "Analytics dashboard retrieved successfully")
  );
});

// Retrieves seller's monthly analytics including sales, earnings, and top products
const getSellerMonthlyAnalytics = asyncHandler(async (req, res) => {
  const userId = req.user._id;
  const { month, year, startDate: startDateParam, endDate: endDateParam } = req.query;

  const seller = await Seller.findOne({ userId });
  if (!seller) {
    throw new ApiError(404, "Seller account not found");
  }

  // Support both month/year and date range filters
  let startDate, endDate;
  if (startDateParam && endDateParam) {
    startDate = new Date(startDateParam);
    endDate = new Date(endDateParam);
    endDate.setHours(23, 59, 59, 999); // End of day
  } else {
    // Default to current month if no dates provided
    const currentYear = year ? parseInt(year) : new Date().getFullYear();
    const currentMonth = month ? parseInt(month) : new Date().getMonth() + 1;
    startDate = new Date(currentYear, currentMonth - 1, 1);
    endDate = new Date(currentYear, currentMonth, 0, 23, 59, 59);
  }

  // Get orders for seller's products in this month
  const orders = await Order.aggregate([
    {
      $match: {
        paymentStatus: 'paid',
        createdAt: { $gte: startDate, $lte: endDate },
      },
    },
    {
      $unwind: '$items',
    },
    {
      $match: {
        'items.sellerId': new mongoose.Types.ObjectId(seller._id),
      },
    },
    {
      $group: {
        _id: null,
        totalSales: { $sum: { $subtract: ['$items.qty', { $ifNull: ['$items.refundedKeysCount', 0] }] } },
        totalRevenue: { $sum: { $subtract: ['$items.lineTotal', { $ifNull: ['$items.refundedAmount', 0] }] } },
        totalCommission: { $sum: '$items.commissionAmount' },
        sellerEarnings: { $sum: { $subtract: ['$items.sellerEarning', { $ifNull: ['$items.refundedSellerAmount', 0] }] } },
        orderCount: { $addToSet: '$_id' },
      },
    },
    {
      $project: {
        totalSales: 1,
        totalRevenue: 1,
        totalCommission: 1,
        sellerEarnings: 1,
        totalOrders: { $size: '$orderCount' },
      },
    },
  ]);

  const topProducts = await Order.aggregate([
    {
      $match: {
        paymentStatus: 'paid',
        createdAt: { $gte: startDate, $lte: endDate },
      },
    },
    {
      $unwind: '$items',
    },
    {
      $match: {
        'items.sellerId': new mongoose.Types.ObjectId(seller._id),
      },
    },
    {
      $group: {
        _id: '$items.productId',
        salesCount: { $sum: { $subtract: ['$items.qty', { $ifNull: ['$items.refundedKeysCount', 0] }] } },
        revenue: { $sum: { $subtract: ['$items.lineTotal', { $ifNull: ['$items.refundedAmount', 0] }] } },
      },
    },
    {
      $lookup: {
        from: 'products',
        localField: '_id',
        foreignField: '_id',
        as: 'product',
      },
    },
    {
      $unwind: '$product',
    },
    {
      $project: {
        productId: '$_id',
        productName: '$product.name',
        productImage: { $arrayElemAt: ['$product.images', 0] },
        salesCount: 1,
        revenue: 1,
      },
    },
    {
      $sort: { salesCount: -1 },
    },
    {
      $limit: 10,
    },
  ]);

  const pendingPayouts = await Payout.aggregate([
    {
      $match: {
        sellerId: new mongoose.Types.ObjectId(seller._id),
        status: 'pending',
      },
    },
    {
      $group: {
        _id: null,
        totalPending: { $sum: '$netAmount' },
        count: { $sum: 1 },
      },
    },
  ]);

  const stats = orders[0] || {
    totalSales: 0,
    totalRevenue: 0,
    totalCommission: 0,
    sellerEarnings: 0,
    totalOrders: 0,
  };

  // Get product counts for the seller
  const totalProducts = await Product.countDocuments({ sellerId: seller._id });
  const activeProducts = await Product.countDocuments({ 
    sellerId: seller._id, 
    status: 'active' 
  });

  // Calculate average order value
  const averageOrderValue = stats.totalSales > 0 
    ? stats.totalRevenue / stats.totalSales 
    : 0;

  // Get all-time totals for comparison
  const allTimeStats = await Order.aggregate([
    {
      $match: {
        paymentStatus: 'paid',
      },
    },
    {
      $unwind: '$items',
    },
    {
      $match: {
        'items.sellerId': new mongoose.Types.ObjectId(seller._id),
      },
    },
    {
      $group: {
        _id: null,
        totalSales: { $sum: { $subtract: ['$items.qty', { $ifNull: ['$items.refundedKeysCount', 0] }] } },
        totalRevenue: { $sum: { $subtract: ['$items.lineTotal', { $ifNull: ['$items.refundedAmount', 0] }] } },
        totalEarnings: { $sum: { $subtract: ['$items.sellerEarning', { $ifNull: ['$items.refundedSellerAmount', 0] }] } },
        orderCount: { $addToSet: '$_id' },
      },
    },
    {
      $project: {
        totalSales: 1,
        totalRevenue: 1,
        totalEarnings: 1,
        totalOrders: { $size: '$orderCount' },
      },
    },
  ]);

  const allTime = allTimeStats[0] || {
    totalSales: 0,
    totalRevenue: 0,
    totalEarnings: 0,
  };

  return res.status(200).json(
    new ApiResponse(200, {
      period: {
        month: month || new Date().getMonth() + 1,
        year: year || new Date().getFullYear(),
        startDate,
        endDate,
      },
      // Period-specific stats
      totalRevenue: stats.totalRevenue,
      totalSales: stats.totalSales,
      totalOrders: stats.totalOrders || 0,
      netEarnings: stats.sellerEarnings,
      totalCommission: stats.totalCommission,
      averageOrderValue,
      // All-time totals
      allTimeRevenue: allTime.totalRevenue,
      allTimeSales: allTime.totalSales,
      allTimeEarnings: allTime.totalEarnings,
      // Product stats
      totalProducts,
      activeProducts,
      // Additional data
      sales: {
        total: stats.totalSales,
        revenue: stats.totalRevenue,
      },
      earnings: {
        total: stats.sellerEarnings,
        commission: stats.totalCommission,
        pending: pendingPayouts[0]?.totalPending || 0,
        pendingCount: pendingPayouts[0]?.count || 0,
      },
      topProducts,
    }, "Monthly analytics retrieved successfully")
  );
});

// Retrieves admin monthly analytics including platform revenue, commission, and user metrics
const getAdminMonthlyAnalytics = asyncHandler(async (req, res) => {
  if (!req.user.roles?.includes('admin')) {
    throw new ApiError(403, "Only admins can view admin analytics");
  }

  const { month, year } = req.query;

  const startDate = new Date(year || new Date().getFullYear(), (month || new Date().getMonth() + 1) - 1, 1);
  const endDate = new Date(year || new Date().getFullYear(), month || new Date().getMonth() + 1, 0, 23, 59, 59);

  const platformRevenue = await Order.aggregate([
    {
      $match: {
        paymentStatus: 'paid',
        createdAt: { $gte: startDate, $lte: endDate },
      },
    },
    {
      $project: {
        totalAmount: 1,
        refundedTotal: { $sum: '$items.refundedAmount' },
      },
    },
    {
      $group: {
        _id: null,
        totalRevenue: { $sum: { $subtract: ['$totalAmount', { $ifNull: ['$refundedTotal', 0] }] } },
        totalOrders: { $sum: 1 },
      },
    },
  ]);

  const commissionIncome = await Order.aggregate([
    {
      $match: {
        paymentStatus: 'paid',
        createdAt: { $gte: startDate, $lte: endDate },
      },
    },
    {
      $unwind: '$items',
    },
    {
      $group: {
        _id: null,
        totalCommission: {
          $sum: {
            $subtract: [
              '$items.commissionAmount',
              { $subtract: [{ $ifNull: ['$items.refundedAmount', 0] }, { $ifNull: ['$items.refundedSellerAmount', 0] }] },
            ],
          },
        },
      },
    },
  ]);

  const activeSellers = await Seller.countDocuments({ status: 'active' });

  const subscriptionUsers = await Subscription.countDocuments({
    status: 'active',
    $or: [
      { endDate: null },
      { endDate: { $gte: new Date() } },
    ],
  });

  const ordersBreakdown = await Order.aggregate([
    {
      $match: {
        paymentStatus: 'paid',
        createdAt: { $gte: startDate, $lte: endDate },
      },
    },
    {
      $project: {
        createdAt: 1,
        totalAmount: 1,
        refundedTotal: { $sum: '$items.refundedAmount' },
      },
    },
    {
      $group: {
        _id: {
          $dateToString: { format: '%Y-%m-%d', date: '$createdAt' },
        },
        count: { $sum: 1 },
        revenue: { $sum: { $subtract: ['$totalAmount', { $ifNull: ['$refundedTotal', 0] }] } },
      },
    },
    {
      $sort: { _id: 1 },
    },
  ]);

  return res.status(200).json(
    new ApiResponse(200, {
      period: {
        month: month || new Date().getMonth() + 1,
        year: year || new Date().getFullYear(),
        startDate,
        endDate,
      },
      revenue: {
        total: platformRevenue[0]?.totalRevenue || 0,
        currency: 'EUR',
      },
      commission: {
        total: commissionIncome[0]?.totalCommission || 0,
        currency: 'EUR',
      },
      orders: {
        total: platformRevenue[0]?.totalOrders || 0,
        breakdown: ordersBreakdown,
      },
      sellers: {
        active: activeSellers,
      },
      subscriptions: {
        active: subscriptionUsers,
      },
    }, "Monthly analytics retrieved successfully")
  );
});

// Creates custom analytics reports with flexible filtering options
const createCustomReport = asyncHandler(async (req, res) => {
  const { reportType, filters, dateRange } = req.body;

  if (!reportType) {
    throw new ApiError(400, "Report type is required");
  }

  const match = {};
  if (dateRange?.startDate) {
    match.createdAt = { $gte: new Date(dateRange.startDate) };
  }
  if (dateRange?.endDate) {
    match.createdAt = { ...match.createdAt, $lte: new Date(dateRange.endDate) };
  }

  let reportData = {};

  switch (reportType) {
    case "sales":
      reportData = await Order.aggregate([
        { $match: { ...match, paymentStatus: "paid" } },
        { $project: { totalAmount: 1, refundedTotal: { $sum: "$items.refundedAmount" } } },
        {
          $group: {
            _id: null,
            totalOrders: { $sum: 1 },
            totalRevenue: { $sum: { $subtract: ["$totalAmount", { $ifNull: ["$refundedTotal", 0] }] } },
            averageOrderValue: { $avg: { $subtract: ["$totalAmount", { $ifNull: ["$refundedTotal", 0] }] } },
          },
        },
      ]);
      break;
    case "products":
      reportData = await Product.aggregate([
        { $match: match },
        {
          $group: {
            _id: "$status",
            count: { $sum: 1 },
          },
        },
      ]);
      break;
    case "users":
      reportData = await User.aggregate([
        { $match: match },
        {
          $group: {
            _id: "$roles",
            count: { $sum: 1 },
          },
        },
      ]);
      break;
    default:
      throw new ApiError(400, "Invalid report type");
  }

  return res.status(200).json(
    new ApiResponse(200, { reportType, filters, dateRange, data: reportData }, "Custom report generated successfully")
  );
});

// Exports analytics report as CSV file
const exportReportCSV = asyncHandler(async (req, res) => {
  const { reportType, dateRange } = req.query;

  if (!reportType) {
    throw new ApiError(400, "Report type is required");
  }

  const match = {};
  if (dateRange?.startDate) {
    match.createdAt = { $gte: new Date(dateRange.startDate) };
  }
  if (dateRange?.endDate) {
    match.createdAt = { ...match.createdAt, $lte: new Date(dateRange.endDate) };
  }

  let csv = "";

  switch (reportType) {
    case "orders":
      const orders = await Order.find({ ...match, paymentStatus: "paid" }).lean();
      csv = [
        ["Order ID", "User ID", "Total Amount", "Status", "Date"].join(","),
        ...orders.map((o) =>
          [o._id, o.userId, o.totalAmount, o.orderStatus, o.createdAt.toISOString()].join(",")
        ),
      ].join("\n");
      break;
    case "products":
      const products = await Product.find(match).lean();
      csv = [
        ["Product ID", "Name", "Price", "Status", "Stock", "Date"].join(","),
        ...products.map((p) =>
          [p._id, p.name, p.price, p.status, p.stock, p.createdAt.toISOString()].join(",")
        ),
      ].join("\n");
      break;
    default:
      throw new ApiError(400, "Invalid report type for CSV export");
  }

  return res
    .status(200)
    .setHeader("Content-Type", "text/csv")
    .setHeader("Content-Disposition", `attachment; filename="${reportType}-report-${Date.now()}.csv"`)
    .send(csv);
});

// Exports analytics report as PDF (returns JSON if pdfkit not available)
const exportReportPDF = asyncHandler(async (req, res) => {
  const { reportType, dateRange } = req.query;

  if (!reportType) {
    throw new ApiError(400, "Report type is required");
  }

  // For now, return JSON. Install pdfkit for PDF generation:
  // npm install pdfkit
  const match = {};
  if (dateRange?.startDate) {
    match.createdAt = { $gte: new Date(dateRange.startDate) };
  }
  if (dateRange?.endDate) {
    match.createdAt = { ...match.createdAt, $lte: new Date(dateRange.endDate) };
  }

  let data = {};
  switch (reportType) {
    case "orders":
      const orders = await Order.find({ ...match, paymentStatus: "paid" }).lean();
      data = { totalOrders: orders.length, orders };
      break;
    case "products":
      const products = await Product.find(match).lean();
      data = { totalProducts: products.length, products };
      break;
    default:
      throw new ApiError(400, "Invalid report type for PDF export");
  }

  return res.status(200).json(
    new ApiResponse(200, { reportType, data, note: "PDF export requires pdfkit package installation" }, "Report data retrieved (PDF generation pending)")
  );
});

// Retrieves real-time analytics counters for users, orders, products, and revenue
const getRealTimeCounters = asyncHandler(async (req, res) => {
  const [totalUsers, activeUsers, totalOrders, totalProducts, totalRevenue] = await Promise.all([
    User.countDocuments(),
    User.countDocuments({ isActive: true }),
    Order.countDocuments({ paymentStatus: "paid" }),
    Product.countDocuments({ status: "active" }),
    Order.aggregate([
      { $match: { paymentStatus: "paid" } },
      { $project: { totalAmount: 1, refundedTotal: { $sum: "$items.refundedAmount" } } },
      { $group: { _id: null, total: { $sum: { $subtract: ["$totalAmount", { $ifNull: ["$refundedTotal", 0] }] } } } },
    ]),
  ]);

  return res.status(200).json(
    new ApiResponse(200, {
      users: { total: totalUsers, active: activeUsers },
      orders: { total: totalOrders },
      products: { total: totalProducts },
      revenue: { total: totalRevenue[0]?.total || 0 },
      timestamp: new Date(),
    }, "Real-time counters retrieved successfully")
  );
});

// Tracks user behavior events for analytics
const trackUserBehavior = asyncHandler(async (req, res) => {
  const { eventType, entityType, entityId, metadata } = req.body;
  const userId = req.user?._id || null;
  const sessionId = req.headers["x-session-id"] || null;

  if (!eventType) {
    throw new ApiError(400, "Event type is required");
  }

  const behavior = await UserBehavior.create({
    userId,
    sessionId,
    eventType,
    entityType,
    entityId: entityId ? new mongoose.Types.ObjectId(entityId) : undefined,
    metadata,
    deviceInfo: {
      userAgent: req.get("user-agent"),
      ipAddress: req.ip,
    },
  });

  return res.status(201).json(
    new ApiResponse(201, behavior, "User behavior tracked successfully")
  );
});

// Retrieves user behavior analytics with optional filtering by date, event type, and user
const getUserBehaviorAnalytics = asyncHandler(async (req, res) => {
  const { startDate, endDate, eventType, userId } = req.query;

  const match = {};
  if (startDate || endDate) {
    match.timestamp = {};
    if (startDate) match.timestamp.$gte = new Date(startDate);
    if (endDate) match.timestamp.$lte = new Date(endDate);
  }
  if (eventType) match.eventType = eventType;
  if (userId) match.userId = new mongoose.Types.ObjectId(userId);

  const analytics = await UserBehavior.aggregate([
    { $match: match },
    {
      $group: {
        _id: "$eventType",
        count: { $sum: 1 },
        uniqueUsers: { $addToSet: "$userId" },
      },
    },
    {
      $project: {
        eventType: "$_id",
        count: 1,
        uniqueUsersCount: { $size: "$uniqueUsers" },
      },
    },
  ]);

  return res.status(200).json(
    new ApiResponse(200, analytics, "User behavior analytics retrieved successfully")
  );
});

export {
  getProductAnalytics,
  incrementProductViews,
  getCategoryAnalytics,
  getTopProducts,
  getAnalyticsDashboard,
  getSellerMonthlyAnalytics,
  getAdminMonthlyAnalytics,
  createCustomReport,
  exportReportCSV,
  exportReportPDF,
  getRealTimeCounters,
  trackUserBehavior,
  getUserBehaviorAnalytics,
};
