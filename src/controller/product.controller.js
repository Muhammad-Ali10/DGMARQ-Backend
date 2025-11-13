import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import mongoose from "mongoose";

import { Product } from "../models/product.model.js";
import { Platform } from "../models/platform.model.js";
import { Region } from "../models/region.model.js";
import { ProductType as Type } from "../models/type.model.js";
import { Genre } from "../models/genre.model.js";
import { Mode } from "../models/mode.model.js";
import { Device } from "../models/device.model.js";
import { LicenseKey } from "../models/licensekey.model.js";

import { validateIds, checkRefs, checkDuplicate, uploadFiles, handleLicenseStock } from "../services/product.service.js";
import { ApiError } from "../utils/ApiError.js"



// ------------------- CREATE PRODUCT -------------------
const createProduct = asyncHandler(async (req, res) => {
  const sellerId = req.user;
  const files = req.files;

  let { categoryId, subCategoryId, name, slug, description, price, stock, platform, region, type, device, genre, mode, isFeatured=false, discount=0 } = req.body;

  name = name?.trim(); 
  slug = slug?.trim(); 
  description = description?.trim();

  if (!name || !slug || !price || !description) throw new ApiError(400, "Missing required fields");

  // --- Validate IDs
  validateIds([
    { id: sellerId, name: "Seller" },
    { id: categoryId, name: "Category" },
    { id: subCategoryId, name: "SubCategory", optional: true },
    { id: platform, name: "Platform" },
    { id: region, name: "Region" },
    { id: type, name: "Type" },
    { id: genre, name: "Genre" },
    { id: mode, name: "Mode" },
    { id: device, name: "Device", optional: true }
  ]);

  // --- Reference Checks
  await checkRefs([
    { model: Platform, id: platform, name: "Platform" },
    { model: Region, id: region, name: "Region" },
    { model: Type, id: type, name: "Type" },
    { model: Genre, id: genre, name: "Genre" },
    { model: Mode, id: mode, name: "Mode" },
    { model: Device, id: device, name: "Device", optional: true }
  ]);

  // --- License stock
  const licenseStock = await handleLicenseStock(type, Type, LicenseKey);
  if (licenseStock !== null) stock = licenseStock;

  // --- Duplicate check
  await checkDuplicate(Product, { $or: [{ name }, { slug }] });

  // --- Upload Images
  const images = await uploadFiles(files);

  // --- Create Product
  const product = await Product.create({ sellerId, categoryId, subCategoryId, name, slug, description, price, stock, images, platform, region, type, genre, mode, device, isFeatured, discount });
  res.status(201).json(new ApiResponse(true, "Product created successfully", product));
});

// ------------------- UPDATE PRODUCT -------------------
const updateProduct = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { categoryId, subCategoryId, name, slug, description, price, stock, platform, region, type, device, genre, mode, isFeatured=false, discount=0 } = req.body;

  if (!mongoose.Types.ObjectId.isValid(id)) throw new ApiError(400, "Invalid Product ID");

  // Validate IDs
  validateIds([
    { id: categoryId, name: "Category" },
    { id: subCategoryId, name: "SubCategory", optional: true },
    { id: platform, name: "Platform" },
    { id: region, name: "Region" },
    { id: type, name: "Type" },
    { id: genre, name: "Genre" },
    { id: mode, name: "Mode" },
    { id: device, name: "Device", optional: true }
  ]);

  await checkRefs([
    { model: Platform, id: platform, name: "Platform" },
    { model: Region, id: region, name: "Region" },
    { model: Type, id: type, name: "Type" },
    { model: Genre, id: genre, name: "Genre" },
    { model: Mode, id: mode, name: "Mode" },
    { model: Device, id: device, name: "Device", optional: true }
  ]);

  // License stock
  const licenseStock = await handleLicenseStock(type, Type, LicenseKey);
  if (licenseStock !== null) stock = licenseStock;

  // Duplicate check
  await checkDuplicate(Product, { $or: [{ name }, { slug }] }, id);

  const product = await Product.findByIdAndUpdate(id, { categoryId, subCategoryId, name, slug, description, price, stock, platform, region, type, genre, mode, device, isFeatured, discount }, { new: true });
  if (!product) throw new ApiError(404, "Product not found");

  res.status(200).json(new ApiResponse(true, "Product updated successfully", product));
});

// ------------------- UPDATE PRODUCT IMAGES -------------------
const updateProductImages = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const files = req.files;

  if (!mongoose.Types.ObjectId.isValid(id)) throw new ApiError(400, "Invalid Product ID");

  const images = await uploadFiles(files);

  const product = await Product.findByIdAndUpdate(id, { $push: { images } }, { new: true });
  if (!product) throw new ApiError(404, "Product not found");

  res.status(200).json(new ApiResponse(true, "Product images updated successfully", product));
});

// ------------------- DELETE PRODUCT -------------------
const deleteProduct = asyncHandler(async (req, res) => {
  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id)) throw new ApiError(400, "Invalid Product ID");

  const product = await Product.findByIdAndDelete(id);
  if (!product) throw new ApiError(404, "Product not found");

  res.status(200).json(new ApiResponse(true, "Product deleted successfully", product));
});

export { createProduct, updateProduct, updateProductImages, deleteProduct };
