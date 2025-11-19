import mongoose, { model } from "mongoose";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { asyncHandler } from "../utils/asyncHandler.js";

import { Category } from "../models/category.model.js";
import { SubCategory } from "../models/subcategory.model.js";
import { Product } from "../models/product.model.js";
import { Platform } from "../models/platform.model.js";
import { Region } from "../models/region.model.js";
import { Type } from "../models/type.model.js";
import { Genre } from "../models/genre.model.js";
import { Mode } from "../models/mode.model.js";
import { Device } from "../models/device.model.js";
import { LicenseKey } from "../models/licensekey.model.js";
import { Theme } from "../models/theme.model.js";
import { fileDelete } from "../utils/deletecloudinary.js";
import {
  validateMongoIds,
  checkModelRefs,
  checkDuplicateRecord,
  uploadImages,
  fetchProducts,
  updateValidateMongoIds,
  updateCheckModelRefs,
  updateCheckDuplicateRecord
} from "../services/product.service.js";

// Create Product
const createProduct = asyncHandler(async (req, res) => {
  const userId = req.user;
  const files = req.files;

  let {
    categoryId,
    subCategoryId,
    name,
    slug,
    description,
    price,
    stock,
    platform,
    region,
    type,
    genre,
    mode,
    device,
    theme,
    isFeatured = false,
    discount = 0,
  } = req.body;

  if (!name || !slug || !price || !description)
    throw new ApiError(400, "Missing required fields");

  validateMongoIds(
    [
      { id: userId, name: "Seller" },
      { id: categoryId, name: "Category" },
      { id: subCategoryId, name: "SubCategory", optional: true },
      { id: platform, name: "Platform" },
      { id: region, name: "Region" },
      { id: type, name: "Type" },
      { id: genre, name: "Genre" },
      { id: mode, name: "Mode" },
      { id: device, name: "Device", optional: true },
      { id: theme, name: "Theme", optional: true },
    ],
    files
  );

  await checkModelRefs(
    [
      { model: Platform, id: platform, name: "Platform" },
      { model: Region, id: region, name: "Region" },
      { model: Type, id: type, name: "Type" },
      { model: Genre, id: genre, name: "Genre" },
      { model: Mode, id: mode, name: "Mode" },
      { model: Device, id: device, name: "Device", optional: true },
      { model: Theme, id: theme, name: "Theme", optional: true },
    ],
    files
  );

  await checkDuplicateRecord(Product, { $or: [{ name }, { slug }] }, files);

  const uploaded = await uploadImages(files);
  const images = uploaded.map((i) => i.url);
  const publicId = uploaded.map((i) => i.public_id);

  const product = await Product.create({
    sellerId: userId,
    categoryId,
    subCategoryId,
    name,
    slug,
    description,
    price,
    stock,
    images,
    publicId,
    platform,
    region,
    type,
    genre,
    mode,
    device,
    theme,
    isFeatured,
    discount,
  });

  return res
    .status(201)
    .json(new ApiResponse(true, "Product created successfully", product));
});

// Update Images
const updateProductImages = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const files = req.files;
  const { removeImages = [] } = req.body;

  if (!mongoose.Types.ObjectId.isValid(id))
    throw new ApiError(400, "Invalid product ID");

  const product = await Product.findById(id);
  if (!product) throw new ApiError(404, "Product not found");

  // Remove images
  if (removeImages.length) {
    for (const pid of removeImages) {
      await fileDelete(pid);
    }

    product.images = product.images.filter(
      (_, idx) => !removeImages.includes(product.publicId[idx])
    );
    product.publicId = product.publicId.filter(
      (pid) => !removeImages.includes(pid)
    );
  }

  // Add new images
  if (files && Object.keys(files).length > 0) {
    const uploaded = await uploadImages(files);
    const newUrls = uploaded.map((i) => i.url);
    const newPids = uploaded.map((i) => i.public_id);

    if (product.images.length + newUrls.length > 5)
      throw new ApiError(400, "Maximum 5 images allowed");

    product.images.push(...newUrls);
    product.publicId.push(...newPids);
  }

  await product.save();

  return res
    .status(200)
    .json(new ApiResponse(true, "Images updated successfully", product));
});

// Delete Product
const deleteProduct = asyncHandler(async (req, res) => {
  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id))
    throw new ApiError(400, "Invalid product ID");

  const product = await Product.findById(id);
  if (!product) throw new ApiError(404, "Product not found");

  for (const pid of product.publicId) {
    await fileDelete(pid);
  }

  await product.deleteOne();

  return res
    .status(200)
    .json(new ApiResponse(true, "Product deleted successfully"));
});

const updateProduct = asyncHandler(async (req, res) => {
  const { id } = req.params;

  let {
    categoryId,
    subCategoryId,
    name,
    slug,
    description,
    price,
    stock,
    platform,
    region,
    type,
    genre,
    mode,
    device,
    theme,
    isFeatured = false,
    discount = 0,
  } = req.body;

  if (!name || !slug || !price || !description)
    throw new ApiError(400, "Missing required fields");

  updateValidateMongoIds([
    { id: categoryId, name: "Category", optional: true },
    { id: subCategoryId, name: "SubCategory", optional: true },
    { id: platform, name: "Platform", optional: true },
    { id: region, name: "Region", optional: true },
    { id: type, name: "Type", optional: true },
    { id: genre, name: "Genre", optional: true },
    { id: mode, name: "Mode", optional: true },
    { id: device, name: "Device", optional: true },
    { id: theme, name: "Theme", optional: true },
  ]);

  await updateCheckModelRefs([
    { model: Category, id: categoryId, name: "Category", optional: true },
    { model: SubCategory, id: subCategoryId, name: "SubCategory", optional: true, },
    { model: Platform, id: platform, name: "Platform" },
    { model: Region, id: region, name: "Region" },
    { model: Type, id: type, name: "Type" },
    { model: Genre, id: genre, name: "Genre" },
    { model: Mode, id: mode, name: "Mode" },
    { model: Device, id: device, name: "Device", optional: true },
    { model: Theme, id: theme, name: "Theme", optional: true },
  ]);

  await updateCheckDuplicateRecord(Product, { $or: [{ name }, { slug }] });

  const product = await Product.findByIdAndUpdate(
    id,
    {
      categoryId,
      subCategoryId,
      name,
      slug,
      description,
      price,
      stock,
      platform,
      region,
      type,
      genre,
      mode,
      device,
      theme,
      isFeatured,
      discount,
    },
    { new: true }
  );

  return res
    .status(200)
    .json(new ApiResponse(true, "Product updated successfully", product));
});

// Get Products
const getProducts = asyncHandler(async (req, res) => {
  const result = await fetchProducts(req.query);

  return res
    .status(200)
    .json(new ApiResponse(true, "Products fetched successfully", result));
});

export {
  createProduct,
  updateProductImages,
  deleteProduct,
  updateProduct,
  getProducts,
};
