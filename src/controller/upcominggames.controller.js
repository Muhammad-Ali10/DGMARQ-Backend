import mongoose from "mongoose";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { UpcomingGames } from "../models/upcominggames.model.js";
import { Product } from "../models/product.model.js";

const getUpcomingGames = asyncHandler(async (req, res) => {
  const config = await UpcomingGames.getOrCreate();

  if (!config.products || config.products.length === 0) {
    return res.status(200).json(
      new ApiResponse(200, [], "No upcoming games configured")
    );
  }

  const sortedProducts = [...config.products]
    .sort((a, b) => a.order - b.order)
    .map((item) => item.productId);

  const products = await Product.find({
    _id: { $in: sortedProducts },
    status: { $in: ["active", "approved"] },
  })
    .select("name slug price discount images platform region averageRating reviewCount")
    .populate("platform", "name")
    .populate("region", "name")
    .limit(6)
    .lean();

  const productMap = new Map(products.map((p) => [p._id.toString(), p]));
  const orderedProducts = sortedProducts
    .map((id) => productMap.get(id.toString()))
    .filter((p) => p !== undefined)
    .slice(0, 6);

  return res.status(200).json(
    new ApiResponse(200, orderedProducts, "Upcoming games retrieved successfully")
  );
});

const getUpcomingGamesConfig = asyncHandler(async (req, res) => {
  const config = await UpcomingGames.getOrCreate();

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

const addProducts = asyncHandler(async (req, res) => {
  const { productIds } = req.body;

  if (!Array.isArray(productIds) || productIds.length === 0) {
    throw new ApiError(400, "productIds must be a non-empty array");
  }

  const validIds = productIds.filter((id) => mongoose.Types.ObjectId.isValid(id));
  if (validIds.length === 0) {
    throw new ApiError(400, "No valid product IDs provided");
  }

  const products = await Product.find({
    _id: { $in: validIds },
    status: { $in: ["draft", "pending", "approved", "active"] },
  });

  if (products.length === 0) {
    throw new ApiError(404, "No products found with the provided IDs (excluding rejected products)");
  }

  const foundProductIds = products.map((p) => p._id.toString());

  const config = await UpcomingGames.getOrCreate();

  const existingProductIds = config.products.map((item) => item.productId.toString());

  const newProductIds = validIds.filter(
    (id) => !existingProductIds.includes(id.toString())
  );

  if (newProductIds.length === 0) {
    throw new ApiError(400, "All products are already in the upcoming games list");
  }

  const productsToAdd = newProductIds.filter((id) =>
    foundProductIds.includes(id.toString())
  );

  if (productsToAdd.length === 0) {
    throw new ApiError(400, "No valid products to add (products may be rejected or not found)");
  }

  const maxOrder =
    config.products.length > 0
      ? Math.max(...config.products.map((item) => item.order))
      : -1;

  productsToAdd.forEach((productId, index) => {
    config.products.push({
      productId,
      order: maxOrder + 1 + index,
      addedAt: new Date(),
    });
  });

  config.updatedAt = new Date();
  await config.save();

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

const removeProducts = asyncHandler(async (req, res) => {
  const { productIds } = req.body;

  if (!Array.isArray(productIds) || productIds.length === 0) {
    throw new ApiError(400, "productIds must be a non-empty array");
  }

  const validIds = productIds.filter((id) => mongoose.Types.ObjectId.isValid(id));
  if (validIds.length === 0) {
    throw new ApiError(400, "No valid product IDs provided");
  }

  const config = await UpcomingGames.getOrCreate();

  const initialLength = config.products.length;
  config.products = config.products.filter(
    (item) => !validIds.some((id) => item.productId.toString() === id.toString())
  );

  if (config.products.length === initialLength) {
    throw new ApiError(404, "No matching products found to remove");
  }

  config.products.forEach((item, index) => {
    item.order = index;
  });

  config.updatedAt = new Date();
  await config.save();

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

const reorderProducts = asyncHandler(async (req, res) => {
  const { productIds } = req.body;

  if (!Array.isArray(productIds)) {
    throw new ApiError(400, "productIds must be an array");
  }

  if (productIds.length === 0) {
    const config = await UpcomingGames.getOrCreate();
    config.products = [];
    config.updatedAt = new Date();
    await config.save();

    return res.status(200).json(
      new ApiResponse(200, { products: [] }, "Order updated successfully")
    );
  }

  const validIds = productIds.filter((id) => mongoose.Types.ObjectId.isValid(id));
  if (validIds.length === 0) {
    throw new ApiError(400, "No valid product IDs provided");
  }

  const config = await UpcomingGames.getOrCreate();

  const existingProductsMap = new Map();
  config.products.forEach((item) => {
    existingProductsMap.set(item.productId.toString(), item);
  });

  const missingIds = validIds.filter(id => !existingProductsMap.has(id.toString()));
  if (missingIds.length > 0) {
    throw new ApiError(400, "Some product IDs do not exist in the upcoming games list");
  }

  const reorderedProducts = validIds.map((id, index) => {
    const existingItem = existingProductsMap.get(id.toString());
    return {
      productId: existingItem.productId,
      order: index,
      addedAt: existingItem.addedAt || new Date(),
    };
  });

  const reorderedIdsSet = new Set(validIds.map(id => id.toString()));
  const notInReorder = config.products.filter(item => 
    !reorderedIdsSet.has(item.productId.toString())
  );
  
  notInReorder.forEach((item, index) => {
    reorderedProducts.push({
      productId: item.productId,
      order: validIds.length + index,
      addedAt: item.addedAt || new Date(),
    });
  });

  config.products = reorderedProducts;

  config.updatedAt = new Date();
  await config.save();

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

const updateUpcomingGames = asyncHandler(async (req, res) => {
  const { productIds } = req.body;

  if (!Array.isArray(productIds)) {
    throw new ApiError(400, "productIds must be an array");
  }

  if (productIds.length === 0) {
    const config = await UpcomingGames.getOrCreate();
    config.products = [];
    config.updatedAt = new Date();
    await config.save();

    return res.status(200).json(
      new ApiResponse(200, { products: [] }, "Upcoming games cleared successfully")
    );
  }

  const validIds = productIds.filter((id) => mongoose.Types.ObjectId.isValid(id));
  if (validIds.length === 0) {
    throw new ApiError(400, "No valid product IDs provided");
  }

  const products = await Product.find({
    _id: { $in: validIds },
    status: { $in: ["draft", "pending", "approved", "active"] },
  });

  if (products.length === 0) {
    throw new ApiError(404, "No products found with the provided IDs (excluding rejected products)");
  }

  const foundProductIds = products.map((p) => p._id.toString());

  const productsToSet = validIds.filter((id) =>
    foundProductIds.includes(id.toString())
  );

  const config = await UpcomingGames.getOrCreate();

  config.products = productsToSet.map((productId, index) => ({
    productId,
    order: index,
    addedAt: new Date(),
  }));

  config.updatedAt = new Date();
  await config.save();

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
