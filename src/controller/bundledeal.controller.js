import mongoose from "mongoose";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { BundleDeal } from "../models/bundledeal.model.js";
import { Product } from "../models/product.model.js";
import { fileUploader } from "../utils/cloudinary.js";

/** Creates bundle deal: 2 products, discount validation, banner image. */
const createBundleDeal = asyncHandler(async (req, res) => {
  const { title, products, discountType, discountValue, startDate, endDate } = req.body;
  const adminId = req.user._id;

  if (!title || !products || !discountType || !discountValue || !startDate || !endDate) {
    throw new ApiError(400, "All fields are required");
  }

  if (!req.file) {
    throw new ApiError(400, "Banner image is required");
  }

  let productIds;
  try {
    productIds = Array.isArray(products) ? products : JSON.parse(products);
  } catch (error) {
    throw new ApiError(400, "Invalid products format. Expected array of 2 product IDs");
  }

  if (!Array.isArray(productIds) || productIds.length !== 2) {
    throw new ApiError(400, "Bundle must contain exactly 2 products");
  }

  if (productIds[0] === productIds[1]) {
    throw new ApiError(400, "Bundle products must be different");
  }

  const validProductIds = productIds.every((id) => mongoose.Types.ObjectId.isValid(id));
  if (!validProductIds) {
    throw new ApiError(400, "Invalid product ID format");
  }

  const [product1, product2] = await Promise.all([
    Product.findById(productIds[0]),
    Product.findById(productIds[1]),
  ]);

  if (!product1 || !product2) {
    throw new ApiError(404, "One or more products not found");
  }
  if (!['active', 'approved'].includes(product1.status) || !['active', 'approved'].includes(product2.status)) {
    throw new ApiError(400, "Both products must be approved to create a bundle");
  }

  if (!["percentage", "fixed"].includes(discountType)) {
    throw new ApiError(400, "Discount type must be 'percentage' or 'fixed'");
  }

  const discountNum = parseFloat(discountValue);
  if (isNaN(discountNum) || discountNum <= 0) {
    throw new ApiError(400, "Discount value must be a positive number");
  }

  if (discountType === "percentage" && (discountNum > 100 || discountNum <= 0)) {
    throw new ApiError(400, "Percentage discount must be between 1 and 100");
  }

  const start = new Date(startDate);
  const end = new Date(endDate);
  const now = new Date();

  if (isNaN(start.getTime()) || isNaN(end.getTime())) {
    throw new ApiError(400, "Invalid date format");
  }

  if (end <= start) {
    throw new ApiError(400, "End date must be after start date");
  }

  const existingBundle = await BundleDeal.findOne({
    products: { $all: productIds, $size: 2 },
  });

  if (existingBundle) {
    throw new ApiError(409, "Bundle with these products already exists");
  }

  const uploadResult = await fileUploader(req.file.path);
  if (!uploadResult || !uploadResult.url) {
    throw new ApiError(500, "Failed to upload banner image");
  }

  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

  const existingSlug = await BundleDeal.findOne({ slug });
  if (existingSlug) {
    throw new ApiError(409, "Bundle with this title already exists");
  }

  const bundleDeal = await BundleDeal.create({
    title: title.trim(),
    slug,
    products: productIds,
    discountType,
    discountValue: discountNum,
    startDate: start,
    endDate: end,
    bannerImage: uploadResult.url,
    bannerImagePublicId: uploadResult.public_id,
    createdBy: adminId,
    isActive: true,
  });

  const populated = await BundleDeal.findById(bundleDeal._id)
    .populate("products", "name price images slug")
    .populate("createdBy", "name email");

  return res.status(201).json(
    new ApiResponse(201, populated, "Bundle deal created successfully")
  );
});

const getAllBundleDeals = asyncHandler(async (req, res) => {
  const { page = 1, limit = 10 } = req.query;

  const aggregate = BundleDeal.aggregate([
    {
      $lookup: {
        from: "products",
        localField: "products",
        foreignField: "_id",
        as: "products",
      },
    },
    {
      $sort: { createdAt: -1 },
    },
  ]);

  const options = {
    page: parseInt(page),
    limit: parseInt(limit),
  };

  const result = await BundleDeal.aggregatePaginate(aggregate, options);

  return res.status(200).json(
    new ApiResponse(200, result, "Bundle deals retrieved successfully")
  );
});

const getActiveBundleDeals = asyncHandler(async (req, res) => {
  const now = new Date();

  const bundleDeals = await BundleDeal.find({
    isActive: true,
    startDate: { $lte: now },
    endDate: { $gte: now },
  })
    .populate("products", "name price images slug")
    .sort({ createdAt: -1 });

  return res.status(200).json(
    new ApiResponse(200, bundleDeals, "Active bundle deals retrieved successfully")
  );
});

const getBundleDealById = asyncHandler(async (req, res) => {
  const { identifier } = req.params;

  let bundleDeal;
  if (mongoose.Types.ObjectId.isValid(identifier)) {
    bundleDeal = await BundleDeal.findById(identifier)
      .populate("products", "name price images slug description")
      .populate("createdBy", "name email");
  } else {
    bundleDeal = await BundleDeal.findOne({ slug: identifier })
      .populate("products", "name price images slug description")
      .populate("createdBy", "name email");
  }

  if (!bundleDeal) {
    throw new ApiError(404, "Bundle deal not found");
  }

  return res.status(200).json(
    new ApiResponse(200, bundleDeal, "Bundle deal retrieved successfully")
  );
});

const updateBundleDeal = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { title, products, discountType, discountValue, startDate, endDate } = req.body;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new ApiError(400, "Invalid bundle deal ID");
  }

  const bundleDeal = await BundleDeal.findById(id);
  if (!bundleDeal) {
    throw new ApiError(404, "Bundle deal not found");
  }

  if (products) {
    let productIds;
    try {
      productIds = Array.isArray(products) ? products : JSON.parse(products);
    } catch (error) {
      throw new ApiError(400, "Invalid products format");
    }

    if (!Array.isArray(productIds) || productIds.length !== 2) {
      throw new ApiError(400, "Bundle must contain exactly 2 products");
    }

    if (productIds[0] === productIds[1]) {
      throw new ApiError(400, "Bundle products must be different");
    }

    const validProductIds = productIds.every((pid) => mongoose.Types.ObjectId.isValid(pid));
    if (!validProductIds) {
      throw new ApiError(400, "Invalid product ID format");
    }

    const [product1, product2] = await Promise.all([
      Product.findById(productIds[0]),
      Product.findById(productIds[1]),
    ]);

    if (!product1 || !product2) {
      throw new ApiError(404, "One or more products not found");
    }

    if (!['active', 'approved'].includes(product1.status) || !['active', 'approved'].includes(product2.status)) {
      throw new ApiError(400, "Both products must be approved to create a bundle");
    }

    const existingBundle = await BundleDeal.findOne({
      _id: { $ne: id },
      products: { $all: productIds, $size: 2 },
    });

    if (existingBundle) {
      throw new ApiError(409, "Bundle with these products already exists");
    }

    bundleDeal.products = productIds;
  }

  if (title) {
    bundleDeal.title = title.trim();
    const slug = title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");

    const existingSlug = await BundleDeal.findOne({ slug, _id: { $ne: id } });
    if (existingSlug) {
      throw new ApiError(409, "Bundle with this title already exists");
    }

    bundleDeal.slug = slug;
  }

  if (discountType) {
    if (!["percentage", "fixed"].includes(discountType)) {
      throw new ApiError(400, "Discount type must be 'percentage' or 'fixed'");
    }
    bundleDeal.discountType = discountType;
  }

  if (discountValue !== undefined) {
    const discountNum = parseFloat(discountValue);
    if (isNaN(discountNum) || discountNum <= 0) {
      throw new ApiError(400, "Discount value must be a positive number");
    }

    if (bundleDeal.discountType === "percentage" && (discountNum > 100 || discountNum <= 0)) {
      throw new ApiError(400, "Percentage discount must be between 1 and 100");
    }

    bundleDeal.discountValue = discountNum;
  }

  if (startDate) {
    const start = new Date(startDate);
    if (isNaN(start.getTime())) {
      throw new ApiError(400, "Invalid start date format");
    }
    bundleDeal.startDate = start;
  }

  if (endDate) {
    const end = new Date(endDate);
    if (isNaN(end.getTime())) {
      throw new ApiError(400, "Invalid end date format");
    }

    const start = bundleDeal.startDate;
    if (end <= start) {
      throw new ApiError(400, "End date must be after start date");
    }
    bundleDeal.endDate = end;
  }

  if (req.file) {
    const uploadResult = await fileUploader(req.file.path);
    if (uploadResult && uploadResult.url) {
      bundleDeal.bannerImage = uploadResult.url;
      bundleDeal.bannerImagePublicId = uploadResult.public_id;
    }
  }

  await bundleDeal.save();

  const populated = await BundleDeal.findById(bundleDeal._id)
    .populate("products", "name price images slug")
    .populate("createdBy", "name email");

  return res.status(200).json(
    new ApiResponse(200, populated, "Bundle deal updated successfully")
  );
});

const deleteBundleDeal = asyncHandler(async (req, res) => {
  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new ApiError(400, "Invalid bundle deal ID");
  }

  const bundleDeal = await BundleDeal.findById(id);
  if (!bundleDeal) {
    throw new ApiError(404, "Bundle deal not found");
  }

  await bundleDeal.deleteOne();

  return res.status(200).json(
    new ApiResponse(200, null, "Bundle deal deleted successfully")
  );
});

const toggleBundleDealStatus = asyncHandler(async (req, res) => {
  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new ApiError(400, "Invalid bundle deal ID");
  }

  const bundleDeal = await BundleDeal.findById(id);
  if (!bundleDeal) {
    throw new ApiError(404, "Bundle deal not found");
  }

  bundleDeal.isActive = !bundleDeal.isActive;
  await bundleDeal.save();

  const populated = await BundleDeal.findById(bundleDeal._id)
    .populate("products", "name price images slug")
    .populate("createdBy", "name email");

  return res.status(200).json(
    new ApiResponse(200, populated, `Bundle deal ${bundleDeal.isActive ? "activated" : "deactivated"} successfully`)
  );
});

export {
  createBundleDeal,
  getAllBundleDeals,
  getActiveBundleDeals,
  getBundleDealById,
  updateBundleDeal,
  deleteBundleDeal,
  toggleBundleDealStatus,
};

