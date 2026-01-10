import mongoose from "mongoose";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { UpcomingGames } from "../models/upcominggames.model.js";
import { Product } from "../models/product.model.js";

/**
 * Get upcoming games for homepage (public)
 * Returns only 6 products, only published/active products
 * GET /api/v1/upcoming-games
 */
const getUpcomingGames = asyncHandler(async (req, res) => {
  const config = await UpcomingGames.getOrCreate();

  if (!config.products || config.products.length === 0) {
    return res.status(200).json(
      new ApiResponse(200, [], "No upcoming games configured")
    );
  }

  // Sort by order and get product IDs
  const sortedProducts = [...config.products]
    .sort((a, b) => a.order - b.order)
    .map((item) => item.productId);

  // Fetch products (limit to 6, only active/approved)
  const products = await Product.find({
    _id: { $in: sortedProducts },
    status: { $in: ["active", "approved"] },
  })
    .select("name slug price discount images platform region averageRating reviewCount")
    .populate("platform", "name")
    .populate("region", "name")
    .limit(6)
    .lean();

  // Maintain order from config
  const productMap = new Map(products.map((p) => [p._id.toString(), p]));
  const orderedProducts = sortedProducts
    .map((id) => productMap.get(id.toString()))
    .filter((p) => p !== undefined)
    .slice(0, 6);

  return res.status(200).json(
    new ApiResponse(200, orderedProducts, "Upcoming games retrieved successfully")
  );
});

/**
 * Get upcoming games configuration (admin)
 * GET /api/v1/upcoming-games/admin
 */
const getUpcomingGamesConfig = asyncHandler(async (req, res) => {
  const config = await UpcomingGames.getOrCreate();

  // Populate product details
  const productIds = config.products.map((item) => item.productId);
  const products = await Product.find({ _id: { $in: productIds } })
    .select("name slug price discount images platform region status")
    .populate("platform", "name")
    .populate("region", "name")
    .lean();

  const productMap = new Map(products.map((p) => [p._id.toString(), p]));

  const populatedProducts = config.products
    .sort((a, b) => a.order - b.order)
    .map((item) => ({
      productId: item.productId,
      product: productMap.get(item.productId.toString()) || null,
      order: item.order,
      addedAt: item.addedAt,
    }));

  return res.status(200).json(
    new ApiResponse(
      200,
      { products: populatedProducts },
      "Upcoming games configuration retrieved successfully"
    )
  );
});

/**
 * Add products to upcoming games (admin)
 * POST /api/v1/upcoming-games/add
 */
const addProducts = asyncHandler(async (req, res) => {
  const { productIds } = req.body;

  if (!Array.isArray(productIds) || productIds.length === 0) {
    throw new ApiError(400, "productIds must be a non-empty array");
  }

  // Validate all product IDs
  const validIds = productIds.filter((id) => mongoose.Types.ObjectId.isValid(id));
  if (validIds.length === 0) {
    throw new ApiError(400, "No valid product IDs provided");
  }

  // Verify products exist and are active/approved
  const products = await Product.find({
    _id: { $in: validIds },
    status: { $in: ["active", "approved"] },
  });

  if (products.length === 0) {
    throw new ApiError(404, "No active/approved products found with the provided IDs");
  }

  const foundProductIds = products.map((p) => p._id.toString());

  // Get or create config
  const config = await UpcomingGames.getOrCreate();

  // Get existing product IDs (as strings for comparison)
  const existingProductIds = config.products.map((item) => item.productId.toString());

  // Filter out duplicates
  const newProductIds = validIds.filter(
    (id) => !existingProductIds.includes(id.toString())
  );

  if (newProductIds.length === 0) {
    throw new ApiError(400, "All products are already in the upcoming games list");
  }

  // Filter to only products that actually exist and are active
  const productsToAdd = newProductIds.filter((id) =>
    foundProductIds.includes(id.toString())
  );

  if (productsToAdd.length === 0) {
    throw new ApiError(400, "No valid active/approved products to add");
  }

  // Get current max order
  const maxOrder =
    config.products.length > 0
      ? Math.max(...config.products.map((item) => item.order))
      : -1;

  // Add new products
  productsToAdd.forEach((productId, index) => {
    config.products.push({
      productId,
      order: maxOrder + 1 + index,
      addedAt: new Date(),
    });
  });

  config.updatedAt = new Date();
  await config.save();

  // Return updated config
  const productIdsToFetch = config.products.map((item) => item.productId);
  const allProducts = await Product.find({ _id: { $in: productIdsToFetch } })
    .select("name slug price discount images platform region status")
    .populate("platform", "name")
    .populate("region", "name")
    .lean();

  const productMap = new Map(allProducts.map((p) => [p._id.toString(), p]));

  const populatedProducts = config.products
    .sort((a, b) => a.order - b.order)
    .map((item) => ({
      productId: item.productId,
      product: productMap.get(item.productId.toString()) || null,
      order: item.order,
      addedAt: item.addedAt,
    }));

  return res.status(200).json(
    new ApiResponse(
      200,
      { products: populatedProducts },
      "Products added successfully"
    )
  );
});

/**
 * Remove products from upcoming games (admin)
 * DELETE /api/v1/upcoming-games/remove
 */
const removeProducts = asyncHandler(async (req, res) => {
  const { productIds } = req.body;

  if (!Array.isArray(productIds) || productIds.length === 0) {
    throw new ApiError(400, "productIds must be a non-empty array");
  }

  // Validate all product IDs
  const validIds = productIds.filter((id) => mongoose.Types.ObjectId.isValid(id));
  if (validIds.length === 0) {
    throw new ApiError(400, "No valid product IDs provided");
  }

  const config = await UpcomingGames.getOrCreate();

  // Remove products
  const initialLength = config.products.length;
  config.products = config.products.filter(
    (item) => !validIds.some((id) => item.productId.toString() === id.toString())
  );

  if (config.products.length === initialLength) {
    throw new ApiError(404, "No matching products found to remove");
  }

  // Reorder remaining products
  config.products.forEach((item, index) => {
    item.order = index;
  });

  config.updatedAt = new Date();
  await config.save();

  // Return updated config
  const productIdsToFetch = config.products.map((item) => item.productId);
  const allProducts = await Product.find({ _id: { $in: productIdsToFetch } })
    .select("name slug price discount images platform region status")
    .populate("platform", "name")
    .populate("region", "name")
    .lean();

  const productMap = new Map(allProducts.map((p) => [p._id.toString(), p]));

  const populatedProducts = config.products
    .sort((a, b) => a.order - b.order)
    .map((item) => ({
      productId: item.productId,
      product: productMap.get(item.productId.toString()) || null,
      order: item.order,
      addedAt: item.addedAt,
    }));

  return res.status(200).json(
    new ApiResponse(
      200,
      { products: populatedProducts },
      "Products removed successfully"
    )
  );
});

/**
 * Update product order (admin)
 * PUT /api/v1/upcoming-games/reorder
 */
const reorderProducts = asyncHandler(async (req, res) => {
  const { productIds } = req.body; // Array of product IDs in new order

  if (!Array.isArray(productIds)) {
    throw new ApiError(400, "productIds must be an array");
  }

  // If empty array, just clear the list
  if (productIds.length === 0) {
    const config = await UpcomingGames.getOrCreate();
    config.products = [];
    config.updatedAt = new Date();
    await config.save();

    return res.status(200).json(
      new ApiResponse(200, { products: [] }, "Order updated successfully")
    );
  }

  // Validate all product IDs
  const validIds = productIds.filter((id) => mongoose.Types.ObjectId.isValid(id));
  if (validIds.length === 0) {
    throw new ApiError(400, "No valid product IDs provided");
  }

  const config = await UpcomingGames.getOrCreate();

  // Create a map of existing products by ID
  const existingProductsMap = new Map();
  config.products.forEach((item) => {
    existingProductsMap.set(item.productId.toString(), item);
  });

  // Verify all product IDs in request exist in config
  const missingIds = validIds.filter(id => !existingProductsMap.has(id.toString()));
  if (missingIds.length > 0) {
    throw new ApiError(400, "Some product IDs do not exist in the upcoming games list");
  }

  // Reorder products: keep only products in the request, in the order specified
  const reorderedProducts = validIds.map((id, index) => {
    const existingItem = existingProductsMap.get(id.toString());
    return {
      productId: existingItem.productId,
      order: index,
      addedAt: existingItem.addedAt || new Date(),
    };
  });

  // Keep products not in the reorder request but put them at the end
  const reorderedIdsSet = new Set(validIds.map(id => id.toString()));
  const notInReorder = config.products.filter(item => 
    !reorderedIdsSet.has(item.productId.toString())
  );
  
  // Add products not in reorder at the end
  notInReorder.forEach((item, index) => {
    reorderedProducts.push({
      productId: item.productId,
      order: validIds.length + index,
      addedAt: item.addedAt || new Date(),
    });
  });

  // Replace products array
  config.products = reorderedProducts;

  config.updatedAt = new Date();
  await config.save();

  // Return updated config
  const productIdsToFetch = config.products.map((item) => item.productId);
  const allProducts = await Product.find({ _id: { $in: productIdsToFetch } })
    .select("name slug price discount images platform region status")
    .populate("platform", "name")
    .populate("region", "name")
    .lean();

  const productMap = new Map(allProducts.map((p) => [p._id.toString(), p]));

  const populatedProducts = config.products
    .sort((a, b) => a.order - b.order)
    .map((item) => ({
      productId: item.productId,
      product: productMap.get(item.productId.toString()) || null,
      order: item.order,
      addedAt: item.addedAt,
    }));

  return res.status(200).json(
    new ApiResponse(
      200,
      { products: populatedProducts },
      "Product order updated successfully"
    )
  );
});

/**
 * Replace all products (admin)
 * PUT /api/v1/upcoming-games
 */
const updateUpcomingGames = asyncHandler(async (req, res) => {
  const { productIds } = req.body;

  if (!Array.isArray(productIds)) {
    throw new ApiError(400, "productIds must be an array");
  }

  // If empty array, just clear the list
  if (productIds.length === 0) {
    const config = await UpcomingGames.getOrCreate();
    config.products = [];
    config.updatedAt = new Date();
    await config.save();

    return res.status(200).json(
      new ApiResponse(200, { products: [] }, "Upcoming games cleared successfully")
    );
  }

  // Validate all product IDs
  const validIds = productIds.filter((id) => mongoose.Types.ObjectId.isValid(id));
  if (validIds.length === 0) {
    throw new ApiError(400, "No valid product IDs provided");
  }

  // Verify products exist and are active/approved
  const products = await Product.find({
    _id: { $in: validIds },
    status: { $in: ["active", "approved"] },
  });

  if (products.length === 0) {
    throw new ApiError(404, "No active/approved products found with the provided IDs");
  }

  const foundProductIds = products.map((p) => p._id.toString());

  // Filter to only products that actually exist and are active
  const productsToSet = validIds.filter((id) =>
    foundProductIds.includes(id.toString())
  );

  // Get or create config
  const config = await UpcomingGames.getOrCreate();

  // Replace all products
  config.products = productsToSet.map((productId, index) => ({
    productId,
    order: index,
    addedAt: new Date(),
  }));

  config.updatedAt = new Date();
  await config.save();

  // Return updated config
  const allProducts = await Product.find({ _id: { $in: productsToSet } })
    .select("name slug price discount images platform region status")
    .populate("platform", "name")
    .populate("region", "name")
    .lean();

  const productMap = new Map(allProducts.map((p) => [p._id.toString(), p]));

  const populatedProducts = config.products
    .sort((a, b) => a.order - b.order)
    .map((item) => ({
      productId: item.productId,
      product: productMap.get(item.productId.toString()) || null,
      order: item.order,
      addedAt: item.addedAt,
    }));

  return res.status(200).json(
    new ApiResponse(
      200,
      { products: populatedProducts },
      "Upcoming games updated successfully"
    )
  );
});

export {
  getUpcomingGames,
  getUpcomingGamesConfig,
  addProducts,
  removeProducts,
  reorderProducts,
  updateUpcomingGames,
};
