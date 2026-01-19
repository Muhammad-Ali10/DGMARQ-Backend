import mongoose from "mongoose";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { logger } from "../utils/logger.js";
import { Seller } from "../models/seller.model.js";
import { Product } from "../models/product.model.js";
import { User } from "../models/user.model.js";
import { Payout } from "../models/payout.model.js";
import { Order } from "../models/order.model.js";
import { Review } from "../models/review.model.js";
import { Conversation } from "../models/conversation.model.js";
import { Message } from "../models/message.model.js";
import { processScheduledPayouts } from "../services/payout.service.js";
import { PlatformSettings } from "../models/platform.model.js";
import { SELLER_STATUS } from "../constants.js";
import { auditLog } from "../services/audit.service.js";
import { SeoSettings } from "../models/seoSettings.model.js";
import { validateMetaTitle, validateMetaDescription } from "../utils/sanitize.js";

// Approves a pending seller application and activates their account
const approveSeller = asyncHandler(async (req, res) => {
  const { sellerId } = req.params;
  const adminId = req.user._id;

  if (!mongoose.Types.ObjectId.isValid(sellerId)) {
    throw new ApiError(400, "Invalid seller ID");
  }

  const seller = await Seller.findById(sellerId);
  if (!seller) {
    throw new ApiError(404, "Seller not found");
  }

  if (seller.status !== "pending") {
    throw new ApiError(400, `Seller is already ${seller.status}`);
  }

  seller.status = "active";
  await seller.save();

  await User.findByIdAndUpdate(seller.userId, {
    $addToSet: { roles: "seller" },
    isActive: true,
  });

  await auditLog(adminId, 'SELLER_APPROVED', `Approved seller: ${seller.shopName}`, {
    sellerId: seller._id,
  });

  return res.status(200).json(
    new ApiResponse(200, seller, "Seller approved successfully")
  );
});

// Rejects a pending seller application and deactivates their account
const rejectSeller = asyncHandler(async (req, res) => {
  const { sellerId } = req.params;
  const { reason } = req.body;
  const adminId = req.user._id;

  if (!mongoose.Types.ObjectId.isValid(sellerId)) {
    throw new ApiError(400, "Invalid seller ID");
  }

  const seller = await Seller.findById(sellerId);
  if (!seller) {
    throw new ApiError(404, "Seller not found");
  }

  if (seller.status !== "pending") {
    throw new ApiError(400, `Seller is already ${seller.status}`);
  }

  seller.status = "banned";
  await seller.save();

  await User.findByIdAndUpdate(seller.userId, {
    isActive: false,
    $pull: { roles: 'seller' },
  });

  await auditLog(adminId, 'SELLER_REJECTED', `Rejected seller: ${seller.shopName}`, {
    sellerId: seller._id,
    reason: reason || null,
  });

  return res.status(200).json(
    new ApiResponse(200, seller, "Seller rejected successfully")
  );
});

// Retrieves all pending seller applications with pagination
const getPendingSellers = asyncHandler(async (req, res) => {
  const { page = 1, limit = 20 } = req.query;

  const sellers = await Seller.find({ status: "pending" })
    .populate("userId", "name email profileImage roles isActive createdAt")
    .select("-__v")
    .sort({ createdAt: -1 })
    .skip((page - 1) * limit)
    .limit(parseInt(limit))
    .lean();

  const total = await Seller.countDocuments({ status: "pending" });

  return res.status(200).json(
    new ApiResponse(200, {
      sellers,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit),
      },
    }, "Pending sellers retrieved successfully")
  );
});

// Retrieves all sellers with optional status filtering and pagination
const getAllSellers = asyncHandler(async (req, res) => {
  const { page = 1, limit = 20, status } = req.query;

  const match = {};
  if (status && status !== 'all') {
    match.status = status;
  }

  const sellers = await Seller.find(match)
    .populate("userId", "name email profileImage roles isActive createdAt")
    .select("-__v")
    .sort({ createdAt: -1 })
    .skip((page - 1) * limit)
    .limit(parseInt(limit))
    .lean();

  const total = await Seller.countDocuments(match);

  return res.status(200).json(
    new ApiResponse(200, {
      sellers,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit),
      },
    }, "Sellers retrieved successfully")
  );
});

// Retrieves detailed seller information including product count, order stats, and revenue
const getSellerDetails = asyncHandler(async (req, res) => {
  const { sellerId } = req.params;

  if (!mongoose.Types.ObjectId.isValid(sellerId)) {
    throw new ApiError(400, "Invalid seller ID");
  }

  const seller = await Seller.findById(sellerId)
    .populate("userId", "name email profileImage roles isActive createdAt")
    .lean();

  if (!seller) {
    throw new ApiError(404, "Seller not found");
  }

  const productCount = await Product.countDocuments({ sellerId: seller._id });
  
  const orderStats = await Order.aggregate([
    { $match: { "items.sellerId": seller._id, paymentStatus: "paid" } },
    { $unwind: "$items" },
    { $match: { "items.sellerId": seller._id } },
    {
      $group: {
        _id: "$_id",
        sellerEarning: { $sum: "$items.sellerEarning" },
      },
    },
    {
      $group: {
        _id: null,
        totalOrders: { $sum: 1 },
        totalRevenue: { $sum: "$sellerEarning" },
      },
    },
  ]);

  const stats = orderStats[0] || { totalOrders: 0, totalRevenue: 0 };

  return res.status(200).json(
    new ApiResponse(200, {
      seller,
      stats: {
        productCount,
        totalOrders: stats.totalOrders,
        totalRevenue: stats.totalRevenue,
      },
    }, "Seller details retrieved successfully")
  );
});

/**
 * Block/Unblock active seller (admin only)
 */
const blockSeller = asyncHandler(async (req, res) => {
  const { sellerId } = req.params;
  const { action, reason } = req.body; // action: 'block' or 'unblock'
  const adminId = req.user._id;

  if (!mongoose.Types.ObjectId.isValid(sellerId)) {
    throw new ApiError(400, "Invalid seller ID");
  }

  if (!['block', 'unblock'].includes(action)) {
    throw new ApiError(400, "Action must be 'block' or 'unblock'");
  }

  const seller = await Seller.findById(sellerId).populate("userId");
  if (!seller) {
    throw new ApiError(404, "Seller not found");
  }

  if (action === 'block') {
    if (seller.status !== 'active') {
      throw new ApiError(400, `Cannot block seller with status: ${seller.status}`);
    }
    seller.status = 'banned';
    // Also deactivate the user account
    if (seller.userId) {
      await User.findByIdAndUpdate(seller.userId._id, { isActive: false });
      await User.findByIdAndUpdate(seller.userId._id, { $pull: { roles: 'seller' } });
    }
  } else {
    if (seller.status !== 'banned') {
      throw new ApiError(400, `Cannot unblock seller with status: ${seller.status}`);
    }
    seller.status = 'active';
    // Reactivate the user account
    if (seller.userId) {
      await User.findByIdAndUpdate(seller.userId._id, { isActive: true });
      await User.findByIdAndUpdate(seller.userId._id, { $addToSet: { roles: 'seller' } });
    }
  }

  await seller.save();

  await auditLog(adminId, action === 'block' ? 'SELLER_BLOCKED' : 'SELLER_UNBLOCKED', 
    `${action === 'block' ? 'Blocked' : 'Unblocked'} seller: ${seller.shopName}`, {
    sellerId: seller._id,
    reason: reason || null,
  });

  return res.status(200).json(
    new ApiResponse(200, seller, `Seller ${action}ed successfully`)
  );
});

/**
 * Approve product
 */
const approveProduct = asyncHandler(async (req, res) => {
  const { productId } = req.params;
  const adminId = req.user._id;

  if (!mongoose.Types.ObjectId.isValid(productId)) {
    throw new ApiError(400, "Invalid product ID");
  }

  const product = await Product.findById(productId);
  if (!product) {
    throw new ApiError(404, "Product not found");
  }

  if (product.status === "active") {
    throw new ApiError(400, "Product is already approved and active");
  }

  product.status = "active";
  product.approvedBy = adminId;
  product.approvedAt = new Date();
  await product.save();

  return res.status(200).json(
    new ApiResponse(200, product, "Product approved successfully")
  );
});

/**
 * Reject product
 */
const rejectProduct = asyncHandler(async (req, res) => {
  const { productId } = req.params;
  const { reason } = req.body;
  const adminId = req.user._id;

  if (!mongoose.Types.ObjectId.isValid(productId)) {
    throw new ApiError(400, "Invalid product ID");
  }

  if (!reason) {
    throw new ApiError(400, "Rejection reason is required");
  }

  const product = await Product.findById(productId);
  if (!product) {
    throw new ApiError(404, "Product not found");
  }

  product.status = "rejected";
  product.rejectionReason = reason;
  await product.save();

  return res.status(200).json(
    new ApiResponse(200, product, "Product rejected successfully")
  );
});

/**
 * Get pending products
 */
const getPendingProducts = asyncHandler(async (req, res) => {
  const { page = 1, limit = 20 } = req.query;
  const { LicenseKey } = await import("../models/licensekey.model.js");
  const mongoose = await import("mongoose");

  const products = await Product.find({ status: "pending" })
    .populate("sellerId", "shopName userId")
    .populate("categoryId", "name")
    .sort({ createdAt: -1 })
    .skip((page - 1) * limit)
    .limit(parseInt(limit))
    .lean();

  const productsWithStock = await Promise.all(products.map(async (product) => {
    const licenseKeyDoc = await LicenseKey.findOne({
      productId: product._id,
    });

    const availableCount = licenseKeyDoc 
      ? licenseKeyDoc.keys.filter(key => !key.isUsed).length 
      : 0;
    
    if (product.stock !== availableCount || product.availableKeysCount !== availableCount) {
      Product.findByIdAndUpdate(product._id, {
        stock: availableCount,
        availableKeysCount: availableCount,
      }).catch(err => logger.error(`Failed to sync stock for product ${product._id}`, err));
    }
    
    return {
      ...product,
      stock: availableCount,
      availableKeysCount: availableCount,
    };
  }));

  const total = await Product.countDocuments({ status: "pending" });

  return res.status(200).json(
    new ApiResponse(200, {
      products: productsWithStock,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit),
      },
    }, "Pending products retrieved successfully")
  );
});

/**
 * Get all products with status filter (admin only)
 */
const getAllProducts = asyncHandler(async (req, res) => {
  const { page = 1, limit = 10, status } = req.query;
  const { LicenseKey } = await import("../models/licensekey.model.js");

  const match = {};
  if (status && status !== 'all') {
    // Handle published-like statuses to include both 'active' and 'approved'
    const normalized = String(status).toLowerCase();
    if (['published', 'approved', 'active'].includes(normalized)) {
      match.status = { $in: ['active', 'approved'] };
    } else {
      match.status = status;
    }
  }

  const products = await Product.find(match)
    .populate("sellerId", "shopName userId")
    .populate("categoryId", "name")
    .sort({ createdAt: -1 })
    .skip((page - 1) * limit)
    .limit(parseInt(limit))
    .lean();

  const productsWithStock = await Promise.all(products.map(async (product) => {
    const licenseKeyDoc = await LicenseKey.findOne({
      productId: product._id,
    });

    const availableCount = licenseKeyDoc 
      ? licenseKeyDoc.keys.filter(key => !key.isUsed).length 
      : 0;
    
    if (product.stock !== availableCount || product.availableKeysCount !== availableCount) {
      Product.findByIdAndUpdate(product._id, {
        stock: availableCount,
        availableKeysCount: availableCount,
      }).catch(err => logger.error(`Failed to sync stock for product ${product._id}`, err));
    }
    
    return {
      ...product,
      stock: availableCount,
      availableKeysCount: availableCount,
    };
  }));

  const total = await Product.countDocuments(match);

  return res.status(200).json(
    new ApiResponse(200, {
      products: productsWithStock,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit),
      },
    }, "Products retrieved successfully")
  );
});

/**
 * Get product details by ID (admin view - read-only)
 */
const getProductDetails = asyncHandler(async (req, res) => {
  const { productId } = req.params;
  const { LicenseKey } = await import("../models/licensekey.model.js");

  if (!mongoose.Types.ObjectId.isValid(productId)) {
    throw new ApiError(400, "Invalid product ID");
  }

  const product = await Product.findById(productId)
    .populate("sellerId", "shopName shopLogo userId")
    .populate("categoryId", "name slug")
    .populate("subCategoryId", "name slug")
    .populate("platform", "name")
    .populate("region", "name")
    .populate("type", "name")
    .populate("genre", "name")
    .populate("mode", "name")
    .populate("device", "name")
    .populate("theme", "name")
    .lean();

  if (!product) {
    throw new ApiError(404, "Product not found");
  }

  const licenseKeyDoc = await LicenseKey.findOne({
    productId: product._id,
  });

  const availableCount = licenseKeyDoc 
    ? licenseKeyDoc.keys.filter(key => !key.isUsed).length 
    : 0;

  // Update stock in database if it's out of sync (async, don't wait)
  if (product.stock !== availableCount || product.availableKeysCount !== availableCount) {
    Product.findByIdAndUpdate(product._id, {
      stock: availableCount,
      availableKeysCount: availableCount,
    }).catch(err => logger.error(`Failed to sync stock for product ${product._id}`, err));
  }

  const productWithStock = {
    ...product,
    stock: availableCount,
    availableKeysCount: availableCount,
  };

  return res.status(200).json(
    new ApiResponse(200, productWithStock, "Product details retrieved successfully")
  );
});

/**
 * Get all payouts (admin view)
 */
const getAllPayouts = asyncHandler(async (req, res) => {
  const { page = 1, limit = 20, status } = req.query;

  const match = {};
  if (status) {
    match.status = status;
  }

  const payouts = await Payout.find(match)
    .populate("sellerId", "shopName")
    .populate("orderId", "totalAmount createdAt")
    .sort({ createdAt: -1 })
    .skip((page - 1) * limit)
    .limit(parseInt(limit));

  const total = await Payout.countDocuments(match);

  return res.status(200).json(
    new ApiResponse(200, {
      payouts,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit),
      },
    }, "Payouts retrieved successfully")
  );
});

/**
 * Manually process payout
 */
const processPayout = asyncHandler(async (req, res) => {
  const { payoutId } = req.params;

  if (!mongoose.Types.ObjectId.isValid(payoutId)) {
    throw new ApiError(400, "Invalid payout ID");
  }

  const payout = await Payout.findById(payoutId).populate("sellerId");
  if (!payout) {
    throw new ApiError(404, "Payout not found");
  }

  if (payout.status !== "pending") {
    throw new ApiError(400, `Payout is already ${payout.status}`);
  }

  // Process payout (this will call the payout service)
  const results = await processScheduledPayouts();
  
  // Find the processed payout
  const processedPayout = await Payout.findById(payoutId);

  return res.status(200).json(
    new ApiResponse(200, processedPayout, "Payout processed successfully")
  );
});

/**
 * Get all users (admin only)
 */
const getAllUsers = asyncHandler(async (req, res) => {
  const { page = 1, limit = 20, role, isActive } = req.query;

  const match = {};
  if (role) {
    // Use $in operator for array field matching
    // For customer role, also include users with no roles or empty roles array
    if (role === 'customer') {
      match.$or = [
        { roles: { $in: [role] } },
        { roles: { $exists: false } },
        { roles: { $size: 0 } },
        { roles: [] }
      ];
    } else {
      match.roles = { $in: [role] };
    }
  }
  if (isActive !== undefined) {
    match.isActive = isActive === 'true';
  }

  const users = await User.find(match)
    .select('-password -refreshToken')
    .sort({ createdAt: -1 })
    .skip((page - 1) * limit)
    .limit(parseInt(limit))
    .lean();

  // Ensure all users have at least a default role for display
  const usersWithRoles = users.map(user => ({
    ...user,
    roles: user.roles && user.roles.length > 0 ? user.roles : ['customer']
  }));

  const total = await User.countDocuments(match);

  return res.status(200).json(
    new ApiResponse(200, {
      users: usersWithRoles,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit),
      },
    }, "Users retrieved successfully")
  );
});

/**
 * Ban/Unban user
 */
const banUser = asyncHandler(async (req, res) => {
  const { userId } = req.params;
  const { action, reason } = req.body; // action: 'ban' or 'unban'

  if (!mongoose.Types.ObjectId.isValid(userId)) {
    throw new ApiError(400, "Invalid user ID");
  }

  if (!['ban', 'unban'].includes(action)) {
    throw new ApiError(400, "Action must be 'ban' or 'unban'");
  }

  const user = await User.findById(userId);
  if (!user) {
    throw new ApiError(404, "User not found");
  }

  if (action === 'ban') {
    user.isActive = false;
    // Remove seller role if user is a seller
    if (user.roles.includes('seller')) {
      await Seller.findOneAndUpdate(
        { userId },
        { status: 'banned' }
      );
    }
  } else {
    user.isActive = true;
  }

  await user.save();

  return res.status(200).json(
    new ApiResponse(200, user, `User ${action}ned successfully`)
  );
});

/**
 * Get dashboard statistics
 */
const getDashboardStats = asyncHandler(async (req, res) => {
  const [
    totalUsers,
    totalSellers,
    pendingSellers,
    totalProducts,
    pendingProducts,
    totalOrders,
    totalRevenue,
    pendingPayouts,
    totalPayouts,
    activeConversations,
    totalCustomers,
  ] = await Promise.all([
    User.countDocuments(),
    Seller.countDocuments({ status: 'active' }),
    Seller.countDocuments({ status: 'pending' }),
    Product.countDocuments({ status: { $in: ['active', 'approved'] } }),
    Product.countDocuments({ status: 'pending' }),
    Order.countDocuments({ paymentStatus: 'paid' }),
    Order.aggregate([
      { $match: { paymentStatus: 'paid' } },
      { $group: { _id: null, total: { $sum: '$totalAmount' } } },
    ]),
    Payout.countDocuments({ status: 'pending' }),
    Payout.countDocuments({ status: 'released' }),
    Conversation.countDocuments({ status: 'active' }),
    User.countDocuments({ roles: { $nin: ['admin', 'seller'] } }),
  ]);

  const revenue = totalRevenue[0]?.total || 0;

  // Recent orders (last 7 days)
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const recentOrders = await Order.countDocuments({
    createdAt: { $gte: sevenDaysAgo },
    paymentStatus: 'paid',
  });

  return res.status(200).json(
    new ApiResponse(200, {
      users: {
        total: totalUsers,
        customers: totalCustomers,
        sellers: {
          active: totalSellers,
          pending: pendingSellers,
        },
      },
      products: {
        total: totalProducts,
        pending: pendingProducts,
      },
      orders: {
        total: totalOrders,
        recent: recentOrders,
      },
      revenue: {
        total: revenue,
        currency: 'EUR',
      },
      payouts: {
        pending: pendingPayouts,
        completed: totalPayouts,
      },
      conversations: {
        active: activeConversations,
      },
    }, "Dashboard statistics retrieved successfully")
  );
});

/**
 * Moderate chat (delete message or block conversation)
 */
const moderateChat = asyncHandler(async (req, res) => {
  const { conversationId } = req.params;
  const { action, messageId } = req.body; // action: 'block' or 'delete_message'

  if (!mongoose.Types.ObjectId.isValid(conversationId)) {
    throw new ApiError(400, "Invalid conversation ID");
  }

  const conversation = await Conversation.findById(conversationId);
  if (!conversation) {
    throw new ApiError(404, "Conversation not found");
  }

  if (action === 'block') {
    conversation.status = 'blocked';
    await conversation.save();
    return res.status(200).json(
      new ApiResponse(200, conversation, "Conversation blocked successfully")
    );
  } else if (action === 'delete_message' && messageId) {
    if (!mongoose.Types.ObjectId.isValid(messageId)) {
      throw new ApiError(400, "Invalid message ID");
    }
    const message = await Message.findByIdAndUpdate(
      messageId,
      { isDeleted: true, deletedAt: new Date() },
      { new: true }
    );
    if (!message) {
      throw new ApiError(404, "Message not found");
    }
    return res.status(200).json(
      new ApiResponse(200, message, "Message deleted successfully")
    );
  } else {
    throw new ApiError(400, "Invalid action or missing messageId");
  }
});

/**
 * Get commission rate (admin only)
 */
const getCommissionRate = asyncHandler(async (req, res) => {
  const setting = await PlatformSettings.findOne({ key: 'commission_rate' });
  const rate = setting ? setting.value : 0.1; // Default 10%

  return res.status(200).json(
    new ApiResponse(200, {
      commissionRate: rate,
      description: 'Platform commission rate (0.0 to 1.0)',
      lastUpdated: setting?.updatedAt || null,
    }, "Commission rate retrieved successfully")
  );
});

/**
 * Update commission rate (admin only)
 */
const updateCommissionRate = asyncHandler(async (req, res) => {
  const adminId = req.user._id;
  const { commissionRate } = req.body;

  if (typeof commissionRate !== 'number' || commissionRate < 0 || commissionRate > 1) {
    throw new ApiError(400, "Commission rate must be a number between 0 and 1 (0% to 100%)");
  }

  const setting = await PlatformSettings.findOneAndUpdate(
    { key: 'commission_rate' },
    {
      key: 'commission_rate',
      value: commissionRate,
      description: 'Platform commission rate (0.0 to 1.0)',
      updatedBy: adminId,
    },
    { upsert: true, new: true }
  );

  await auditLog(adminId, "COMMISSION_RATE_UPDATED", `Commission rate updated to ${(commissionRate * 100).toFixed(1)}%`, {
    oldRate: setting.value,
    newRate: commissionRate,
  });

  return res.status(200).json(
    new ApiResponse(200, {
      commissionRate: setting.value,
      message: `Commission rate updated to ${(commissionRate * 100).toFixed(1)}%`,
    }, "Commission rate updated successfully")
  );
});

/**
 * Get auto-approve products setting (admin only)
 */
const getAutoApproveSetting = asyncHandler(async (req, res) => {
  const setting = await PlatformSettings.findOne({ key: 'auto_approve_products' });
  const autoApprove = setting ? setting.value === true : false;

  return res.status(200).json(
    new ApiResponse(200, {
      autoApprove,
      description: 'Auto-approve seller products on creation (true = enabled, false = disabled)',
      lastUpdated: setting?.updatedAt || null,
    }, "Auto-approve setting retrieved successfully")
  );
});

/**
 * Update auto-approve products setting (admin only)
 */
const updateAutoApproveSetting = asyncHandler(async (req, res) => {
  const adminId = req.user._id;
  const { autoApprove } = req.body;

  if (typeof autoApprove !== 'boolean') {
    throw new ApiError(400, "Auto-approve must be a boolean (true or false)");
  }

  const setting = await PlatformSettings.findOneAndUpdate(
    { key: 'auto_approve_products' },
    {
      key: 'auto_approve_products',
      value: autoApprove,
      description: 'Auto-approve seller products on creation (true = enabled, false = disabled)',
      updatedBy: adminId,
    },
    { upsert: true, new: true }
  );

  await auditLog(adminId, "AUTO_APPROVE_UPDATED", `Auto-approve products set to ${autoApprove ? 'enabled' : 'disabled'}`, {
    autoApprove,
  });

  return res.status(200).json(
    new ApiResponse(200, {
      autoApprove: setting.value,
      message: `Auto-approve products ${autoApprove ? 'enabled' : 'disabled'}`,
    }, "Auto-approve setting updated successfully")
  );
});

/**
 * Get home page SEO settings (admin only)
 */
const getHomePageSEO = asyncHandler(async (req, res) => {
  const seoSettings = await SeoSettings.findOne({ page: 'home' });

  if (!seoSettings) {
    // Return default values if not set
    return res.status(200).json(
      new ApiResponse(200, {
        page: 'home',
        metaTitle: '',
        metaDescription: '',
        lastUpdated: null,
      }, "Home page SEO settings retrieved successfully")
    );
  }

  return res.status(200).json(
    new ApiResponse(200, {
      page: seoSettings.page,
      metaTitle: seoSettings.metaTitle,
      metaDescription: seoSettings.metaDescription,
      lastUpdated: seoSettings.updatedAt,
    }, "Home page SEO settings retrieved successfully")
  );
});

/**
 * Update home page SEO settings (admin only)
 */
const updateHomePageSEO = asyncHandler(async (req, res) => {
  const adminId = req.user._id;
  const { metaTitle, metaDescription } = req.body;

  if (!metaTitle || !metaDescription) {
    throw new ApiError(400, "Meta title and meta description are required");
  }

  // Validate meta title
  const metaTitleValidation = validateMetaTitle(metaTitle);
  if (!metaTitleValidation.valid) {
    throw new ApiError(400, metaTitleValidation.error);
  }

  // Validate meta description
  const metaDescriptionValidation = validateMetaDescription(metaDescription);
  if (!metaDescriptionValidation.valid) {
    throw new ApiError(400, metaDescriptionValidation.error);
  }

  // Upsert SEO settings
  const seoSettings = await SeoSettings.findOneAndUpdate(
    { page: 'home' },
    {
      page: 'home',
      metaTitle: metaTitleValidation.value,
      metaDescription: metaDescriptionValidation.value,
      updatedBy: adminId,
    },
    { upsert: true, new: true }
  );

  await auditLog(adminId, "SEO_SETTINGS_UPDATED", "Home page SEO settings updated", {
    page: 'home',
  });

  return res.status(200).json(
    new ApiResponse(200, {
      page: seoSettings.page,
      metaTitle: seoSettings.metaTitle,
      metaDescription: seoSettings.metaDescription,
      lastUpdated: seoSettings.updatedAt,
    }, "Home page SEO settings updated successfully")
  );
});

export {
  approveSeller,
  rejectSeller,
  getPendingSellers,
  getAllSellers,
  getSellerDetails,
  blockSeller,
  approveProduct,
  rejectProduct,
  getPendingProducts,
  getAllProducts,
  getProductDetails,
  getAllPayouts,
  processPayout,
  getAllUsers,
  banUser,
  getDashboardStats,
  moderateChat,
  getCommissionRate,
  updateCommissionRate,
  getAutoApproveSetting,
  updateAutoApproveSetting,
  getHomePageSEO,
  updateHomePageSEO,
};

