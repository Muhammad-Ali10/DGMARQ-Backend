 import mongoose, { model } from "mongoose";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { logger } from "../utils/logger.js";

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
import { Seller } from "../models/seller.model.js";
import { fileDelete } from "../utils/deletecloudinary.js";
import { fileDeleteFromCloud } from "../utils/deleteFilesFromCloud.js";
import { validateMetaTitle, validateMetaDescription } from "../utils/sanitize.js";
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

const createProduct = asyncHandler(async (req, res) => {
  const userId = req.user?._id || req.user;
  const files = req.files;

  const seller = await Seller.findOne({ userId });
  if (!seller) {
    throw new ApiError(403, "Seller account not found. Please apply to become a seller first.");
  }

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
    productType = 'LICENSE_KEY', 
    metaTitle,
    metaDescription,
  } = req.body;

  if (!name || !slug || !price || !description)
    throw new ApiError(400, "Missing required fields");

  if (productType && !['LICENSE_KEY', 'ACCOUNT_BASED'].includes(productType.toUpperCase())) {
    fileDeleteFromCloud(files);
    throw new ApiError(400, "Invalid productType. Must be 'LICENSE_KEY' or 'ACCOUNT_BASED'");
  }
  productType = productType.toUpperCase();

  validateMongoIds(
    [
      { id: seller._id, name: "Seller" },
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

  const metaTitleValidation = validateMetaTitle(metaTitle);
  if (!metaTitleValidation.valid) {
    fileDeleteFromCloud(files);
    throw new ApiError(400, metaTitleValidation.error);
  }

  const metaDescriptionValidation = validateMetaDescription(metaDescription);
  if (!metaDescriptionValidation.valid) {
    fileDeleteFromCloud(files);
    throw new ApiError(400, metaDescriptionValidation.error);
  }

  const uploaded = await uploadImages(files);
  const images = uploaded.map((i) => i.url);
  const publicId = uploaded.map((i) => i.public_id);

  // Check auto-approve setting
  const { PlatformSettings } = await import("../models/platform.model.js");
  const autoApproveSetting = await PlatformSettings.findOne({ key: 'auto_approve_products' });
  const autoApprove = autoApproveSetting ? autoApproveSetting.value === true : false;

  // Determine initial status based on auto-approve setting
  let initialStatus = 'pending';
  let approvedBy = null;
  let approvedAt = null;

  if (autoApprove) {
    initialStatus = 'active';
    // Note: approvedBy would be null for auto-approved products, but we could set it to system
    approvedAt = new Date();
  }

  const product = await Product.create({
    sellerId: seller._id,
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
    productType,
    metaTitle: metaTitleValidation.value,
    metaDescription: metaDescriptionValidation.value,
    status: initialStatus,
    approvedBy,
    approvedAt,
  });

  return res
    .status(201)
    .json(new ApiResponse(true, product, "Product created successfully"));
});

const updateProductImages = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const files = req.files;
  const { removeImages = [] } = req.body;

  if (!mongoose.Types.ObjectId.isValid(id))
    throw new ApiError(400, "Invalid product ID");

  const product = await Product.findById(id);
  if (!product) throw new ApiError(404, "Product not found");

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
    .json(new ApiResponse(true, product, "Images updated successfully"));
});

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
  const userId = req.user._id;
  const isAdmin = req.user.roles?.includes('admin');

  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new ApiError(400, "Invalid product ID");
  }

  const existingProduct = await Product.findById(id);
  if (!existingProduct) {
    throw new ApiError(404, "Product not found");
  }

  if (!isAdmin) {
    const seller = await Seller.findOne({ userId });
    if (!seller || existingProduct.sellerId.toString() !== seller._id.toString()) {
      throw new ApiError(403, "You don't have permission to update this product");
    }
  }

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
    metaTitle,
    metaDescription,
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

  await updateCheckDuplicateRecord(Product, { $or: [{ name }, { slug }] }, id);

  const metaTitleValidation = validateMetaTitle(metaTitle);
  if (!metaTitleValidation.valid) {
    throw new ApiError(400, metaTitleValidation.error);
  }

  const metaDescriptionValidation = validateMetaDescription(metaDescription);
  if (!metaDescriptionValidation.valid) {
    throw new ApiError(400, metaDescriptionValidation.error);
  }

  const updateData = {
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
  };

  if (metaTitle !== undefined) {
    updateData.metaTitle = metaTitleValidation.value;
  }
  if (metaDescription !== undefined) {
    updateData.metaDescription = metaDescriptionValidation.value;
  }

  const product = await Product.findByIdAndUpdate(
    id,
    updateData,
    { new: true }
  );

  return res
    .status(200)
    .json(new ApiResponse(true, product, "Product updated successfully"));
});

const getProducts = asyncHandler(async (req, res) => {
  const userId = req.user?._id;
  const userRoles = Array.isArray(req.user?.roles) ? req.user?.roles : (req.user?.role ? [req.user.role] : []);
  const isSeller = userRoles.includes('seller');
  let query = { ...req.query };

  if (isSeller && userId && !query.sellerId) {
    const seller = await Seller.findOne({ userId });
    if (!seller) {
      return res.status(200).json(new ApiResponse(true, {
        docs: [],
        totalDocs: 0,
        limit: parseInt(query.limit) || 10,
        page: parseInt(query.page) || 1,
        totalPages: 0,
        hasNextPage: false,
        hasPrevPage: false,
      }, "No seller account found"));
    }
    query.sellerId = seller._id.toString();
    query.userId = userId.toString();
  }

  const result = await fetchProducts(query, req.user);

  return res
    .status(200)
    .json(new ApiResponse(true, result, "Products fetched successfully"));
  
});



const getProductById = asyncHandler(async (req, res) => {
  const { identifier } = req.params;

  if (!identifier) {
    throw new ApiError(400, "Product identifier is required");
  }

  const actionRoutes = ['upload-keys', 'keys', 'sync-stock', 'create-product', 'update-product-images', 'delete-product', 'update-product', 'get-products'];
  if (actionRoutes.includes(identifier.toLowerCase())) {
    throw new ApiError(404, "Product not found");
  }

  let product;
  let productBeforePopulate;
  
  if (mongoose.Types.ObjectId.isValid(identifier)) {
    // First fetch without populate to check if sellerId exists
    productBeforePopulate = await Product.findById(identifier).lean();
    
    // Debug logging removed - use logger.debug if needed
    
    product = await Product.findById(identifier)
      .populate("sellerId", "shopName shopLogo shopBanner description country state city rating status")
      .populate("categoryId", "name slug")
      .populate("subCategoryId", "name slug")
      .populate("platform", "name")
      .populate("region", "name")
      .populate("type", "name")
      .populate("genre", "name")
      .populate("mode", "name")
      .populate("device", "name")
      .populate("theme", "name");
  } else {
    // First fetch without populate to check if sellerId exists
    productBeforePopulate = await Product.findOne({ slug: identifier }).lean();
    
    // Debug logging removed
    
    product = await Product.findOne({ slug: identifier })
      .populate("sellerId", "shopName shopLogo shopBanner description country state city rating status")
      .populate("categoryId", "name slug")
      .populate("subCategoryId", "name slug")
      .populate("platform", "name")
      .populate("region", "name")
      .populate("type", "name")
      .populate("genre", "name")
      .populate("mode", "name")
      .populate("device", "name")
      .populate("theme", "name");
  }

  if (!product) {
    throw new ApiError(404, "Product not found");
  }

  // Debug logging removed - use logger.debug if needed

  // Increment view count atomically (don't fetch, just update)
  await Product.findByIdAndUpdate(
    product._id,
    { $inc: { viewCount: 1 } },
    { new: false }
  );
  
  // Update the product object with incremented viewCount
  product.viewCount = (product.viewCount || 0) + 1;

  // Convert to object and ensure all populated fields are included
  const productObject = product.toObject();
  
  // Get the original sellerId - use the value from before populate if available
  let originalSellerId = null;
  
  // First, try to get sellerId from the product before populate (most reliable)
  if (productBeforePopulate && productBeforePopulate.sellerId) {
    originalSellerId = productBeforePopulate.sellerId;
  }
  // Then check if sellerId was populated (object with _id)
  else if (product.sellerId) {
    if (typeof product.sellerId === 'object' && product.sellerId._id) {
      // Populated seller object
      originalSellerId = product.sellerId._id;
    } else if (product.sellerId instanceof mongoose.Types.ObjectId) {
      // Raw ObjectId
      originalSellerId = product.sellerId;
    } else if (typeof product.sellerId === 'string') {
      // String ID
      originalSellerId = product.sellerId;
    }
  }
  // Fallback to productObject.sellerId
  else if (productObject.sellerId) {
    if (typeof productObject.sellerId === 'object' && productObject.sellerId._id) {
      originalSellerId = productObject.sellerId._id;
    } else {
      originalSellerId = productObject.sellerId;
    }
  }
  
  // Explicitly ensure sellerId is included if it was populated
  // When sellerId is populated, it becomes an object with seller data
  if (product.sellerId && typeof product.sellerId === 'object' && product.sellerId._id) {
    // Seller is populated, include all fields explicitly
    productObject.sellerId = {
      _id: product.sellerId._id,
      shopName: product.sellerId.shopName || null,
      shopLogo: product.sellerId.shopLogo || null,
      shopBanner: product.sellerId.shopBanner || null,
      description: product.sellerId.description || null,
      country: product.sellerId.country || null,
      state: product.sellerId.state || null,
      city: product.sellerId.city || null,
      rating: product.sellerId.rating || 0,
      status: product.sellerId.status || null,
    };
  } else if (originalSellerId) {
    // SellerId exists but wasn't populated (seller document might not exist)
    // Try to fetch seller manually
    try {
      const { Seller } = await import("../models/seller.model.js");
      const sellerDoc = await Seller.findById(originalSellerId).select("shopName shopLogo shopBanner description country state city rating status");
      
      if (sellerDoc) {
        productObject.sellerId = {
          _id: sellerDoc._id,
          shopName: sellerDoc.shopName || null,
          shopLogo: sellerDoc.shopLogo || null,
          shopBanner: sellerDoc.shopBanner || null,
          description: sellerDoc.description || null,
          country: sellerDoc.country || null,
          state: sellerDoc.state || null,
          city: sellerDoc.city || null,
          rating: sellerDoc.rating || 0,
          status: sellerDoc.status || null,
        };
        logger.debug('Seller fetched successfully', { shopName: productObject.sellerId.shopName });
      } else {
        // Seller document doesn't exist, keep the ID
        logger.warn('Seller document not found for sellerId', { sellerId: originalSellerId });
        productObject.sellerId = originalSellerId;
      }
    } catch (err) {
      logger.error('Error fetching seller', err);
      // Keep the original sellerId if fetch fails
      productObject.sellerId = originalSellerId;
    }
  } else {
    // If sellerId is null or undefined, the product doesn't have a seller assigned
    logger.warn('Product does not have a sellerId assigned', { productId: product._id });
    productObject.sellerId = null;
  }

  // Add trending offer pricing if available
  let productResponse = {
    ...productObject,
    metaTitle: product.metaTitle || null,
    metaDescription: product.metaDescription || null,
  };

  // Check for trending offer
  try {
    const { getTrendingOfferForProduct, calculateTrendingOfferDiscount } = await import("../services/trendingoffer.service.js");
    const offer = await getTrendingOfferForProduct(product._id);
    if (offer) {
      const pricing = await calculateTrendingOfferDiscount(product._id, product.price);
      productResponse = {
        ...productResponse,
        trendingOffer: {
          discountPercent: offer.discountPercent,
          offerId: offer._id,
        },
        discountedPrice: pricing.discountedPrice,
        hasTrendingOffer: true,
      };
    }
  } catch (error) {
    // If trending offer service fails, continue without it
    logger.error('Error fetching trending offer', error);
  }

  return res
    .status(200)
    .json(new ApiResponse(true, productResponse, "Product retrieved successfully"));
});

const uploadKeys = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const userId = req.user._id;
  const { keys } = req.body;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new ApiError(400, "Invalid product ID");
  }

  if (!keys || !Array.isArray(keys) || keys.length === 0) {
    throw new ApiError(400, "Keys array is required and must not be empty");
  }

  const product = await Product.findById(id);
  if (!product) {
    throw new ApiError(404, "Product not found");
  }

  const seller = await Seller.findOne({ userId });
  if (!seller) {
    throw new ApiError(403, "Seller account not found. You must be a seller to upload keys.");
  }

  const productSellerId = product.sellerId?._id || product.sellerId;
  
  const productSellerIdObj = productSellerId instanceof mongoose.Types.ObjectId 
    ? productSellerId 
    : new mongoose.Types.ObjectId(productSellerId);
  const sellerIdObj = seller._id instanceof mongoose.Types.ObjectId 
    ? seller._id 
    : new mongoose.Types.ObjectId(seller._id);
  const sellerUserIdObj = seller.userId instanceof mongoose.Types.ObjectId 
    ? seller.userId 
    : new mongoose.Types.ObjectId(seller.userId);
  
  const isOwnerBySellerId = productSellerIdObj.equals(sellerIdObj);
  const isOwnerByUserId = productSellerIdObj.equals(sellerUserIdObj);
  const isOwner = isOwnerBySellerId || isOwnerByUserId;

  if (!isOwner) {
    throw new ApiError(403, "You don't have permission to upload keys for this product. This product belongs to another seller.");
  }

  if (product.status === 'rejected') {
    throw new ApiError(403, "Cannot upload keys for a rejected product. Please contact admin or create a new product.");
  }

  const firstKey = keys[0];
  const isAccountData = typeof firstKey === 'object' && firstKey !== null;
  const uploadType = isAccountData ? 'ACCOUNT_BASED' : 'LICENSE_KEY';

  if (product.productType !== uploadType) {
    throw new ApiError(400, 
      `Product type mismatch. This product is ${product.productType} type, but you're uploading ${uploadType} data. ` +
      `${product.productType === 'LICENSE_KEY' ? 'Upload license keys (strings).' : 'Upload account credentials (email/password objects).'}`
    );
  }

  const { bulkUploadKeys } = await import("../services/key.service.js");
  
  const result = await bulkUploadKeys(id, keys, seller._id);

  return res.status(200).json(
    new ApiResponse(200, result, `${uploadType === 'LICENSE_KEY' ? 'Keys' : 'Accounts'} uploaded successfully`)
  );
});

const getProductKeys = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const userId = req.user._id;
  const { page = 1, limit = 50 } = req.query;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new ApiError(400, "Invalid product ID");
  }

  const product = await Product.findById(id);
  if (!product) {
    throw new ApiError(404, "Product not found");
  }

  const seller = await Seller.findOne({ userId });
  if (!seller) {
    throw new ApiError(403, "Access denied");
  }

  const productSellerId = product.sellerId?._id || product.sellerId;
  
  const productSellerIdObj = productSellerId instanceof mongoose.Types.ObjectId 
    ? productSellerId 
    : new mongoose.Types.ObjectId(productSellerId);
  const sellerIdObj = seller._id instanceof mongoose.Types.ObjectId 
    ? seller._id 
    : new mongoose.Types.ObjectId(seller._id);
  const sellerUserIdObj = seller.userId instanceof mongoose.Types.ObjectId 
    ? seller.userId 
    : new mongoose.Types.ObjectId(seller.userId);
  
  const isOwnerBySellerId = productSellerIdObj.equals(sellerIdObj);
  const isOwnerByUserId = productSellerIdObj.equals(sellerUserIdObj);
  const isOwner = isOwnerBySellerId || isOwnerByUserId;

  if (!isOwner) {
    throw new ApiError(403, "Access denied");
  }

  const { getProductKeys: getKeys } = await import("../services/key.service.js");
  const result = await getKeys(id, seller._id, parseInt(page), parseInt(limit));

  return res.status(200).json(
    new ApiResponse(200, result, "Product keys retrieved successfully")
  );
});

const syncStock = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const userId = req.user._id;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new ApiError(400, "Invalid product ID");
  }

  const product = await Product.findById(id);
  if (!product) {
    throw new ApiError(404, "Product not found");
  }

  const seller = await Seller.findOne({ userId });
  if (!seller) {
    throw new ApiError(403, "Access denied");
  }

  const productSellerId = product.sellerId?._id || product.sellerId;
  
  const productSellerIdObj = productSellerId instanceof mongoose.Types.ObjectId 
    ? productSellerId 
    : new mongoose.Types.ObjectId(productSellerId);
  const sellerIdObj = seller._id instanceof mongoose.Types.ObjectId 
    ? seller._id 
    : new mongoose.Types.ObjectId(seller._id);
  const sellerUserIdObj = seller.userId instanceof mongoose.Types.ObjectId 
    ? seller.userId 
    : new mongoose.Types.ObjectId(seller.userId);
  
  const isOwnerBySellerId = productSellerIdObj.equals(sellerIdObj);
  const isOwnerByUserId = productSellerIdObj.equals(sellerUserIdObj);
  const isOwner = isOwnerBySellerId || isOwnerByUserId;

  if (!isOwner) {
    throw new ApiError(403, "Access denied");
  }

  const { syncProductStock } = await import("../services/key.service.js");
  const availableCount = await syncProductStock(id);

  return res.status(200).json(
    new ApiResponse(200, { availableCount, productId: id }, "Stock synced successfully")
  );
});

const duplicateProduct = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const userId = req.user._id;
  const isAdmin = req.user.roles?.includes("admin");

  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new ApiError(400, "Invalid product ID");
  }

  const originalProduct = await Product.findById(id);

  if (!originalProduct) {
    throw new ApiError(404, "Product not found");
  }

  if (!isAdmin) {
    const seller = await Seller.findOne({ userId });
    if (!seller || originalProduct.sellerId.toString() !== seller._id.toString()) {
      throw new ApiError(403, "You don't have permission to duplicate this product");
    }
  }

  const duplicateData = {
    ...originalProduct.toObject(),
    _id: undefined,
    name: `${originalProduct.name} (Copy)`,
    slug: `${originalProduct.slug}-copy-${Date.now()}`,
    status: "pending",
    createdAt: undefined,
    updatedAt: undefined,
  };

  const duplicatedProduct = await Product.create(duplicateData);

  return res.status(201).json(
    new ApiResponse(201, duplicatedProduct, "Product duplicated successfully")
  );
});

export {
  createProduct,
  updateProductImages,
  deleteProduct,
  updateProduct,
  getProducts,
  getProductById,
  uploadKeys,
  getProductKeys,
  syncStock,
  duplicateProduct,
};
