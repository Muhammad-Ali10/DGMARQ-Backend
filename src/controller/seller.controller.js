import { asyncHandler } from "../utils/asyncHandler.js";
import { User } from "../models/user.model.js";
import { Seller } from "../models/seller.model.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { fileUploader } from "../utils/cloudinary.js";
import { SELLER_STATUS } from "../constants.js";
import { Product } from "../models/product.model.js";
import { Order } from "../models/order.model.js";




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

  console.log(kycDocsImages);

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


const getSellerInfo = asyncHandler(async (req, res) => {
  const userId = req.user?._id;
  if (!userId) throw new ApiError(401, "Unauthorized: User not found in request");


  const seller = await Seller.findOne({ userId }).lean();
  if (!seller) throw new ApiError(404, "Seller not found");


  const [productCount, orderCount] = await Promise.all([
    Product.countDocuments({ sellerId: seller._id }),
    Order.countDocuments({ sellerId: seller._id }),
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



export { applySeller, updateShopLogo, updateShopBanner, updateSellerStatus, getSellers, getSellerInfo };
