import { asyncHandler } from "../utils/asyncHandler.js";
import { User } from "../models/user.model.js";
import { Seller } from "../models/seller.model.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { fileUploader } from "../utils/cloudinary.js";
import { SELLER_STATUS } from "../constants.js";
import { Product } from "../models/product.model.js";
import { Order } from "../models/order.model.js";
import { Payout } from "../models/payout.model.js";
import { Review } from "../models/review.model.js";
import { getSellerBalance, getSellerPayouts } from "../services/payout.service.js";
import mongoose from "mongoose";




// Submits a seller application with shop details and KYC documents
const applySeller = asyncHandler(async (req, res) => {
  const { shopName, description, country, state, city } = req.body;

  if (![shopName, description, country, state, city].every(Boolean)) {
    throw new ApiError(400, "All fields are required");
  }

  const files = req.files || {};
  if (!files.shopLogo?.[0] || !files.shopBanner?.[0] || !files.kycDocs) {
    throw new ApiError(400, "Shop logo, banner & KYC docs are required");
  }


  const [shopLogoImage, shopBannerImage, kycDocsImages] = await Promise.all([
    fileUploader(files.shopLogo[0].path),
    fileUploader(files.shopBanner[0].path),
    Promise.all(files.kycDocs.map((file) => fileUploader(file.path)))
  ]);

  // KYC docs images uploaded successfully

  const user = await User.findById(req.user._id);
  if (!user) throw new ApiError(404, "User not found");


  const existingSeller = await Seller.findOne({ shopName }).lean();
  if (existingSeller) throw new ApiError(409, "Seller already exists");

  const seller = await Seller.create({
    userId: req.user._id,
    shopName,
    description,
    country,
    state,
    city,
    shopLogo: shopLogoImage.url,
    shopBanner: shopBannerImage.url,
    kycDocs: kycDocsImages.map((file) => file.url),
    status: "pending"
  });

  return res
    .status(201)
    .json(new ApiResponse(201, seller, "Seller application submitted"));
});


// Retrieves sellers with optional status filtering and pagination
const getSellers = asyncHandler(async (req, res) => {
  const { page = 1, limit = 10, status } = req.query;

  if (status && !SELLER_STATUS.includes(status)) {
    throw new ApiError(400, "Invalid status");
  }

  const matchStage = {};
  if (status) matchStage.status = status;

  const sellerAggregate = Seller.aggregate([
    { $match: matchStage },
    {
      $lookup: {
        from: "users",
        localField: "userId",
        foreignField: "_id",
        as: "user",
        pipeline: [
          { $project: { name: 1, email: 1, profileImage: 1 } },
        ],
      },
    },
    { $unwind: "$user" },
    {
      $project: {
        shopName: 1,
        shopLogo: 1,
        status: 1,
        "user.name": 1,
        "user.email": 1,
        "user.profileImage": 1,
      },
    },
    { $sort: { createdAt: -1 } },
  ]);

  const Sellers = await Seller.aggregatePaginate(sellerAggregate, {
    page: parseInt(page),
    limit: parseInt(limit),
  });

  return res
    .status(200)
    .json(new ApiResponse(200, Sellers, "Sellers fetched successfully"));
});


// Updates seller shop logo image
const updateShopLogo = asyncHandler(async (req, res) => {
  if (!req.file?.path) throw new ApiError(400, "Logo file required");

  const uploaded = await fileUploader(req.file.path);
  const seller = await Seller.findOneAndUpdate(
    { userId: req.user._id },
    { $set: { shopLogo: uploaded.url } },
    { new: true }
  ).lean();

  if (!seller) throw new ApiError(404, "Seller not found");

  res
    .status(200)
    .json(new ApiResponse(200, seller, "Shop logo updated successfully"));
});



// Updates seller shop banner image
const updateShopBanner = asyncHandler(async (req, res) => {
  if (!req.file?.path) throw new ApiError(400, "Banner file required");

  const uploaded = await fileUploader(req.file.path);
  const seller = await Seller.findOneAndUpdate(
    { userId: req.user._id },
    { $set: { shopBanner: uploaded.url } },
    { new: true }
  ).lean();

  if (!seller) throw new ApiError(404, "Seller not found");

  res
    .status(200)
    .json(new ApiResponse(200, seller, "Shop banner updated successfully"));
});



const updateSellerStatus = asyncHandler(async (req, res) => {
  const { sellerId } = req.params;
  const { status } = req.body;

  if (!status) throw new ApiError(400, "Status is required");

  if (!SELLER_STATUS.includes(status))
    throw new ApiError(400, "Invalid status");


  const seller = await Seller.findByIdAndUpdate(
    sellerId,
    { $set: { status } },
    { new: true }
  ).lean();

  if (!seller) throw new ApiError(404, "Seller not found");


  if (status === "active") {
    await User.updateOne(
      { _id: seller.userId },
      { $addToSet: { roles: "seller" } }
    );
  } else if (status === "banned") {
    await User.updateOne(
      { _id: seller.userId },
      { $pull: { roles: "seller" } }
    );
  }

  res
    .status(200)
    .json(new ApiResponse(200, seller, "Seller status updated successfully"));
});


/**
 * Check seller application status (for customers to check their application)
 */
const checkSellerApplicationStatus = asyncHandler(async (req, res) => {
  const userId = req.user?._id;
  if (!userId) throw new ApiError(401, "Unauthorized: User not found in request");

  const seller = await Seller.findOne({ userId }).lean();
  if (!seller) {
    return res.status(200).json(
      new ApiResponse(200, { hasApplication: false }, "No seller application found")
    );
  }

  return res.status(200).json(
    new ApiResponse(200, { hasApplication: true, seller }, "Seller application status retrieved")
  );
});

const getSellerInfo = asyncHandler(async (req, res) => {
  const userId = req.user?._id;
  if (!userId) throw new ApiError(401, "Unauthorized: User not found in request");


  const seller = await Seller.findOne({ userId }).lean();
  if (!seller) throw new ApiError(404, "Seller not found");


  const [productCount, orderCount] = await Promise.all([
    Product.countDocuments({ sellerId: seller._id }),
    Order.countDocuments({ 
      'items.sellerId': seller._id,
      paymentStatus: 'paid' // Only count paid orders
    }),
  ]);

  const sellerInfo = {
    ...seller,
    stats: {
      totalProducts: productCount,
      totalOrders: orderCount,
    },
  };

  return res
    .status(200)
    .json(new ApiResponse(200, sellerInfo, "Seller info fetched successfully"));
});



// Updates seller profile information
const updateSellerProfile = asyncHandler(async (req, res) => {
  const userId = req.user._id;
  const { shopName, description, country, state, city } = req.body;

  const seller = await Seller.findOne({ userId });

  if (!seller) {
    throw new ApiError(404, "Seller account not found");
  }

  const updateData = {};
  if (shopName) updateData.shopName = shopName;
  if (description !== undefined) updateData.description = description;
  if (country) updateData.country = country;
  if (state) updateData.state = state;
  if (city) updateData.city = city;

  const updatedSeller = await Seller.findByIdAndUpdate(
    seller._id,
    updateData,
    { new: true }
  );

  return res.status(200).json(
    new ApiResponse(200, updatedSeller, "Seller profile updated successfully")
  );
});

// Retrieves seller withdrawal history with optional status filtering
const getSellerWithdrawalHistory = asyncHandler(async (req, res) => {
  const userId = req.user._id;
  const { page = 1, limit = 20, status } = req.query;

  const seller = await Seller.findOne({ userId });

  if (!seller) {
    throw new ApiError(404, "Seller account not found");
  }

  const result = await getSellerPayouts(seller._id, parseInt(page), parseInt(limit));
  
  if (status) {
    result.payouts = result.payouts.filter(p => p.status === status);
    result.pagination.total = result.payouts.length;
    result.pagination.pages = Math.ceil(result.pagination.total / parseInt(limit));
  }

  return res.status(200).json(
    new ApiResponse(200, result, "Withdrawal history retrieved successfully")
  );
});

// Retrieves seller performance metrics including sales, revenue, and product statistics
const getSellerPerformanceMetrics = asyncHandler(async (req, res) => {
  const userId = req.user._id;
  const { startDate, endDate } = req.query;

  const seller = await Seller.findOne({ userId });

  if (!seller) {
    throw new ApiError(404, "Seller account not found");
  }

  const dateFilter = {};
  if (startDate || endDate) {
    dateFilter.createdAt = {};
    if (startDate) dateFilter.createdAt.$gte = new Date(startDate);
    if (endDate) dateFilter.createdAt.$lte = new Date(endDate);
  }

  const salesMetrics = await Order.aggregate([
    {
      $match: {
        paymentStatus: "paid",
        ...dateFilter,
      },
    },
    {
      $unwind: "$items",
    },
    {
      $match: {
        "items.sellerId": new mongoose.Types.ObjectId(seller._id),
      },
    },
    {
      $group: {
        _id: null,
        totalSales: { $sum: "$items.qty" },
        totalRevenue: { $sum: "$items.lineTotal" },
        totalCommission: { $sum: "$items.commissionAmount" },
        netEarnings: { $sum: "$items.sellerEarning" },
      },
    },
  ]);

  const productCount = await Product.countDocuments({ sellerId: seller._id });
  const activeProductCount = await Product.countDocuments({
    sellerId: seller._id,
    status: "active",
  });

  const reviewMetrics = await Review.aggregate([
    {
      $lookup: {
        from: "products",
        localField: "productId",
        foreignField: "_id",
        as: "product",
      },
    },
    {
      $unwind: "$product",
    },
    {
      $match: {
        "product.sellerId": new mongoose.Types.ObjectId(seller._id),
      },
    },
    {
      $group: {
        _id: null,
        totalReviews: { $sum: 1 },
        averageRating: { $avg: "$rating" },
      },
    },
  ]);

  const payoutMetrics = await Payout.aggregate([
    {
      $match: {
        sellerId: new mongoose.Types.ObjectId(seller._id),
        ...dateFilter,
      },
    },
    {
      $group: {
        _id: "$status",
        total: { $sum: "$netAmount" },
        count: { $sum: 1 },
      },
    },
  ]);

  return res.status(200).json(
    new ApiResponse(200, {
      sales: salesMetrics[0] || {
        totalSales: 0,
        totalRevenue: 0,
        totalCommission: 0,
        netEarnings: 0,
      },
      products: {
        total: productCount,
        active: activeProductCount,
      },
      reviews: reviewMetrics[0] || {
        totalReviews: 0,
        averageRating: 0,
      },
      payouts: payoutMetrics,
    }, "Performance metrics retrieved successfully")
  );
});

// Retrieves seller verification badge status based on KYC, activity, and sales criteria
const getSellerVerificationBadge = asyncHandler(async (req, res) => {
  const userId = req.user._id;

  const seller = await Seller.findOne({ userId });

  if (!seller) {
    throw new ApiError(404, "Seller account not found");
  }

  const hasKYC = seller.kycDocs && seller.kycDocs.length > 0;
  const isActive = seller.status === "active";
  const hasPayoutAccount = seller.payoutAccount && seller.payoutAccount !== "inactive";
  const hasProducts = await Product.countDocuments({ sellerId: seller._id }) > 0;
  const hasSales = await Order.countDocuments({
    "items.sellerId": seller._id,
    paymentStatus: "paid",
  }) > 0;

  const isVerified = hasKYC && isActive && hasPayoutAccount && hasProducts && hasSales;

  return res.status(200).json(
    new ApiResponse(200, {
      isVerified,
      criteria: {
        hasKYC,
        isActive,
        hasPayoutAccount,
        hasProducts,
        hasSales,
      },
      badge: isVerified ? "verified" : "unverified",
    }, "Verification badge status retrieved successfully")
  );
});

// Get public seller profile (no auth required)
const getPublicSellerProfile = asyncHandler(async (req, res) => {
  const { sellerId } = req.params;

  if (!mongoose.Types.ObjectId.isValid(sellerId)) {
    throw new ApiError(400, "Invalid seller ID");
  }

  const seller = await Seller.findById(sellerId)
    .populate("userId", "name email profileImage createdAt")
    .lean();

  if (!seller) {
    throw new ApiError(404, "Seller not found");
  }

  // Only show active sellers publicly
  if (seller.status !== "active") {
    throw new ApiError(404, "Seller not found");
  }

  // Get seller stats
  const [productCount, reviewStats] = await Promise.all([
    Product.countDocuments({ sellerId: seller._id, status: "active" }),
    Review.aggregate([
      {
        $lookup: {
          from: "products",
          localField: "productId",
          foreignField: "_id",
          as: "product",
        },
      },
      { $unwind: "$product" },
      {
        $match: {
          "product.sellerId": new mongoose.Types.ObjectId(seller._id),
          isHidden: false,
          $or: [
            { moderationStatus: "approved" },
            { moderationStatus: { $exists: false } },
            { moderationStatus: "pending", isModerated: false },
          ],
        },
      },
      {
        $group: {
          _id: null,
          averageRating: { $avg: "$rating" },
          totalReviews: { $sum: 1 },
        },
      },
    ]),
  ]);

  const stats = reviewStats[0] || { averageRating: 0, totalReviews: 0 };

  const sellerProfile = {
    _id: seller._id,
    shopName: seller.shopName,
    shopLogo: seller.shopLogo,
    shopBanner: seller.shopBanner,
    description: seller.description,
    country: seller.country,
    state: seller.state,
    city: seller.city,
    rating: seller.rating || stats.averageRating || 0,
    createdAt: seller.createdAt,
    user: {
      name: seller.userId?.name,
      profileImage: seller.userId?.profileImage,
      joinedDate: seller.userId?.createdAt,
    },
    stats: {
      totalProducts: productCount,
      averageRating: stats.averageRating || 0,
      totalReviews: stats.totalReviews || 0,
    },
  };

  return res
    .status(200)
    .json(new ApiResponse(200, sellerProfile, "Seller profile retrieved successfully"));
});

// Get seller products (public, paginated)
const getSellerProducts = asyncHandler(async (req, res) => {
  const { sellerId } = req.params;
  const { page = 1, limit = 10 } = req.query;

  if (!mongoose.Types.ObjectId.isValid(sellerId)) {
    throw new ApiError(400, "Invalid seller ID");
  }

  const seller = await Seller.findById(sellerId);
  if (!seller || seller.status !== "active") {
    throw new ApiError(404, "Seller not found");
  }

  const matchStage = {
    sellerId: new mongoose.Types.ObjectId(sellerId),
    status: "active", // Only show active products
  };

  const productAggregate = Product.aggregate([
    { $match: matchStage },
    {
      $lookup: {
        from: "categories",
        localField: "categoryId",
        foreignField: "_id",
        as: "category",
      },
    },
    {
      $lookup: {
        from: "subcategories",
        localField: "subCategoryId",
        foreignField: "_id",
        as: "subCategory",
      },
    },
    {
      $lookup: {
        from: "platforms",
        localField: "platform",
        foreignField: "_id",
        as: "platform",
      },
    },
    {
      $lookup: {
        from: "regions",
        localField: "region",
        foreignField: "_id",
        as: "region",
      },
    },
    {
      $unwind: { path: "$category", preserveNullAndEmptyArrays: true },
    },
    {
      $unwind: { path: "$subCategory", preserveNullAndEmptyArrays: true },
    },
    {
      $unwind: { path: "$platform", preserveNullAndEmptyArrays: true },
    },
    {
      $unwind: { path: "$region", preserveNullAndEmptyArrays: true },
    },
    {
      $project: {
        name: 1,
        slug: 1,
        description: 1,
        price: 1,
        discount: 1,
        images: 1,
        averageRating: 1,
        reviewCount: 1,
        stock: 1,
        status: 1,
        createdAt: 1,
        category: { name: 1, slug: 1 },
        subCategory: { name: 1, slug: 1 },
        platform: { name: 1 },
        region: { name: 1 },
      },
    },
    { $sort: { createdAt: -1 } },
  ]);

  const result = await Product.aggregatePaginate(productAggregate, {
    page: parseInt(page),
    limit: parseInt(limit),
  });

  return res
    .status(200)
    .json(new ApiResponse(200, result, "Seller products fetched successfully"));
});

// Get seller reviews (summary + recent reviews)
const getSellerReviews = asyncHandler(async (req, res) => {
  const { sellerId } = req.params;

  if (!mongoose.Types.ObjectId.isValid(sellerId)) {
    throw new ApiError(400, "Invalid seller ID");
  }

  const seller = await Seller.findById(sellerId);
  if (!seller || seller.status !== "active") {
    throw new ApiError(404, "Seller not found");
  }

  // Get review summary
  const reviewSummary = await Review.aggregate([
    {
      $lookup: {
        from: "products",
        localField: "productId",
        foreignField: "_id",
        as: "product",
      },
    },
    { $unwind: "$product" },
    {
      $match: {
        "product.sellerId": new mongoose.Types.ObjectId(sellerId),
        isHidden: false,
        $or: [
          { moderationStatus: "approved" },
          { moderationStatus: { $exists: false } },
          { moderationStatus: "pending", isModerated: false },
        ],
      },
    },
    {
      $group: {
        _id: null,
        averageRating: { $avg: "$rating" },
        totalReviews: { $sum: 1 },
        ratingBreakdown: {
          $push: "$rating",
        },
      },
    },
  ]);

  const summary = reviewSummary[0] || {
    averageRating: 0,
    totalReviews: 0,
    ratingBreakdown: [],
  };

  // Calculate rating breakdown
  const breakdown = [5, 4, 3, 2, 1].map((rating) => ({
    rating,
    count: summary.ratingBreakdown.filter((r) => r === rating).length,
  }));

  // Get recent reviews (latest 10)
  const recentReviews = await Review.aggregate([
    {
      $lookup: {
        from: "products",
        localField: "productId",
        foreignField: "_id",
        as: "product",
      },
    },
    { $unwind: "$product" },
    {
      $match: {
        "product.sellerId": new mongoose.Types.ObjectId(sellerId),
        isHidden: false,
        $or: [
          { moderationStatus: "approved" },
          { moderationStatus: { $exists: false } },
          { moderationStatus: "pending", isModerated: false },
        ],
      },
    },
    {
      $lookup: {
        from: "users",
        localField: "userId",
        foreignField: "_id",
        as: "user",
        pipeline: [{ $project: { name: 1, profileImage: 1 } }],
      },
    },
    { $unwind: "$user" },
    {
      $project: {
        _id: 1,
        rating: 1,
        comment: 1,
        createdAt: 1,
        isVerifiedPurchase: 1,
        helpfulCount: 1,
        "user.name": 1,
        "user.profileImage": 1,
        "product.name": 1,
        "product.slug": 1,
      },
    },
    { $sort: { createdAt: -1 } },
    { $limit: 10 },
  ]);

  return res.status(200).json(
    new ApiResponse(200, {
      summary: {
        averageRating: summary.averageRating || 0,
        totalReviews: summary.totalReviews || 0,
        ratingBreakdown: breakdown,
      },
      recentReviews,
    }, "Seller reviews fetched successfully")
  );
});
export { 
  applySeller, 
  updateShopLogo, 
  updateShopBanner,
  updateSellerStatus, 
  getSellers, 
  checkSellerApplicationStatus,
  getSellerInfo,
  updateSellerProfile,
  getSellerWithdrawalHistory,
  getSellerPerformanceMetrics,
  getSellerVerificationBadge,
  getPublicSellerProfile,
  getSellerProducts,
  getSellerReviews,
};

