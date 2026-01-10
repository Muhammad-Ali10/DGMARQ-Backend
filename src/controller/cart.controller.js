import mongoose from "mongoose";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { Cart } from "../models/cart.model.js";
import { Product } from "../models/product.model.js";
import { BundleDeal } from "../models/bundledeal.model.js";
import { checkCartForBundle } from "../services/bundledeal.service.js";
import { checkKeyAvailability } from "../services/key.service.js";

// Adds an item to the user's cart or updates quantity if item already exists
const addItemToCart = asyncHandler(async (req, res) => {
  const userId = req.user._id;
  const { productId, qty } = req.body;

  if (!productId) {
    throw new ApiError(400, "Missing required fields");
  }
  if (!mongoose.Types.ObjectId.isValid(productId)) {
    throw new ApiError(400, "Invalid product ID");
  }

  const product = await Product.findById(productId);
  if (!product) {
    throw new ApiError(404, "Product not found");
  }

  const requestedQty = qty || 1;

  // FIX: Check stock availability
  if (product.stock < requestedQty) {
    throw new ApiError(400, "Insufficient stock for the product");
  }

  // FIX: Check key availability before adding to cart
  const keyAvailability = await checkKeyAvailability(productId, requestedQty);
  if (!keyAvailability.available) {
    throw new ApiError(400, keyAvailability.message || "No available keys for this product");
  }

  let cart = await Cart.findOne({ userId });
  if (!cart) {
    cart = await Cart.create({
      userId,
      items: [
        {
          productId,
          sellerId: product.sellerId,
          qty: requestedQty,
          unitPrice: product.price,
        },
      ],
    });
  } else {
    const existingItem = cart.items.find(
      (item) => item.productId.toString() === productId
    );

    if (existingItem) {
      const newQty = existingItem.qty + requestedQty;
      
      // FIX: Re-check key availability for the new total quantity
      const keyAvailability = await checkKeyAvailability(productId, newQty);
      if (!keyAvailability.available) {
        throw new ApiError(400, keyAvailability.message || "Insufficient keys available for the requested quantity");
      }
      
      existingItem.qty = newQty;
      existingItem.unitPrice = product.price;
    } else {
      cart.items.push({
        productId,
        sellerId: product.sellerId,
        qty: requestedQty,
        unitPrice: product.price,
      });
    }
  }

  await cart.save();

  return res
    .status(200)
    .json(new ApiResponse(true, cart,"Item added to cart"));
});

// Retrieves user's cart with populated product details and bundle discount calculations
const getCart = asyncHandler(async (req, res) => {
  const userId = req.user._id;
  let cart = await Cart.findOne({ userId }).populate("items.productId", "name images price slug").lean();

  // If cart doesn't exist, create an empty cart instead of throwing error
  if (!cart) {
    const newCart = await Cart.create({ userId, items: [] });
    cart = await Cart.findById(newCart._id).populate("items.productId", "name images price slug").lean();
  }

  // Handle empty cart
  if (!cart.items || cart.items.length === 0) {
    return res.status(200).json(
      new ApiResponse(true, {
        items: [],
        subtotal: 0,
        bundleDiscount: 0,
        bundleDeal: null,
        total: 0,
      }, "Cart retrieved successfully (empty)")
    );
  }

  // Filter out items with null productId (deleted products)
  const validItems = cart.items.filter(item => {
    // Check if productId exists and is not null
    if (!item.productId) return false;
    // If productId is populated, check if it has _id, otherwise check if it's a valid ObjectId
    const productId = item.productId?._id || item.productId;
    return productId !== null && productId !== undefined;
  });
  
  // If there are invalid items, clean them up from the cart
  if (validItems.length !== cart.items.length) {
    // Get the original cart document (not lean) to update
    const cartDoc = await Cart.findById(cart._id);
    if (cartDoc) {
      // Map validItems back to the format needed for database (extract productId properly)
      const validItemsForDB = validItems.map(item => ({
        productId: item.productId?._id || item.productId,
        sellerId: item.sellerId,
        qty: item.qty,
        unitPrice: item.unitPrice,
      }));
      cartDoc.items = validItemsForDB;
      await cartDoc.save();
    }
  }

  // Handle case where all items were invalid
  if (validItems.length === 0) {
    return res.status(200).json(
      new ApiResponse(true, {
        items: [],
        subtotal: 0,
        bundleDiscount: 0,
        bundleDeal: null,
        total: 0,
      }, "Cart retrieved successfully (empty - invalid items removed)")
    );
  }

  // FIX: Check key availability for each item and add availability info
  const cartItems = await Promise.all(
    validItems.map(async (item) => {
      // Safely get productId - handle both populated and non-populated cases
      const productId = item.productId?._id || item.productId;
      
      if (!productId) {
        return null; // Skip invalid items
      }

      const keyAvailability = await checkKeyAvailability(productId, item.qty);
      return {
        product: item.productId,
        qty: item.qty,
        unitPrice: item.unitPrice,
        totalPrice: item.qty * item.unitPrice,
        isAvailable: keyAvailability.available,
        availableKeys: keyAvailability.availableCount,
        availabilityMessage: keyAvailability.message,
      };
    })
  );

  // Filter out any null items that might have been returned
  const filteredCartItems = cartItems.filter(item => item !== null);

  const subtotal = filteredCartItems.reduce((acc, item) => acc + item.totalPrice, 0);

  const bundleInfo = await checkCartForBundle(validItems);
  
  let total = subtotal;
  let bundleDiscount = 0;
  let bundleDeal = null;

  if (bundleInfo) {
    bundleDiscount = bundleInfo.discountAmount;
    total = bundleInfo.discountedTotal;
    bundleDeal = bundleInfo.bundleDeal;
  }

  return res.status(200).json(
    new ApiResponse(true,  {
      items: filteredCartItems,
      subtotal,
      bundleDiscount,
      bundleDeal: bundleDeal ? {
        _id: bundleDeal._id,
        title: bundleDeal.title,
        slug: bundleDeal.slug,
      } : null,
      total,
    },"Cart retrieved successfully")
  );
});

// Removes an item from the user's cart
const removeItemFromCart = asyncHandler(async (req, res) => {
  const userId = req.user._id;
  const { productId } = req.body;

  if (!productId) {
    throw new ApiError(400, "Missing required fields");
  }

  if (!mongoose.Types.ObjectId.isValid(productId)) {
    throw new ApiError(400, "Invalid product ID");
  }

  const cart = await Cart.findOneAndUpdate(
    { userId },
    { $pull: { items: { productId } } },
    { new: true }
  );

  if (!cart) {
    throw new ApiError(404, "Cart not found");
  }

  return res
    .status(200)
    .json(new ApiResponse(true, cart,"Item removed from cart"));
});

// Clears all items from the user's cart
const clearCart = asyncHandler(async (req, res) => {
  const userId = req.user._id;

  const cart = await Cart.findOneAndUpdate(
    { userId },
    { $set: { items: [] } },
    { new: true }
  );

  if (!cart) {
    throw new ApiError(404, "Cart not found");
  }

  return res
    .status(200)
    .json(new ApiResponse(true, cart,"Cart cleared successfully" ));
});

// Updates the quantity of an item in the user's cart
const updateCart = asyncHandler(async (req, res) => {
  const  userId  = req.user._id;
  const { productId, qty } = req.body;

  if (!productId || qty == null) {
    throw new ApiError(400, "Missing required fields");
  }
  if (!mongoose.Types.ObjectId.isValid(productId)) {
    throw new ApiError(400, "Invalid product ID");
  }
  const cart = await Cart.findOne({ userId });

  if (!cart) {
    throw new ApiError(404, "Cart not found");
  }

  const item = cart.items.find(
    (item) => item.productId.toString() === productId
  );

  if (!item) {
    throw new ApiError(404, "Item not found in the cart");
  }

  // FIX: Check key availability before updating quantity
  if (qty <= 0) {
    throw new ApiError(400, "Quantity must be greater than 0");
  }

  const keyAvailability = await checkKeyAvailability(productId, qty);
  if (!keyAvailability.available) {
    throw new ApiError(400, keyAvailability.message || "Insufficient keys available for the requested quantity");
  }

  item.qty = qty;
  await cart.save();

  return res
    .status(200)
    .json(new ApiResponse(true, cart,"Cart updated successfully" ));
});

// Adds a bundle deal to cart by adding both products from the bundle
const addBundleToCart = asyncHandler(async (req, res) => {
  const userId = req.user._id;
  const { bundleDealId } = req.body;

  if (!bundleDealId) {
    throw new ApiError(400, "Bundle deal ID is required");
  }

  if (!mongoose.Types.ObjectId.isValid(bundleDealId)) {
    throw new ApiError(400, "Invalid bundle deal ID");
  }

  const bundleDeal = await BundleDeal.findById(bundleDealId).populate("products");

  if (!bundleDeal) {
    throw new ApiError(404, "Bundle deal not found");
  }

  const now = new Date();
  if (!bundleDeal.isActive || bundleDeal.startDate > now || bundleDeal.endDate < now) {
    throw new ApiError(400, "Bundle deal is not currently active");
  }

  if (!bundleDeal.products || bundleDeal.products.length !== 2) {
    throw new ApiError(400, "Bundle deal must contain exactly 2 products");
  }

  const [product1, product2] = bundleDeal.products;

  if (!product1 || !product2) {
    throw new ApiError(404, "One or more products in bundle not found");
  }

  // FIX: Check key availability for both products in bundle
  const product1Availability = await checkKeyAvailability(product1._id, 1);
  const product2Availability = await checkKeyAvailability(product2._id, 1);

  if (!product1Availability.available) {
    throw new ApiError(400, `${product1.name || 'Product 1'}: ${product1Availability.message || 'No available keys'}`);
  }

  if (!product2Availability.available) {
    throw new ApiError(400, `${product2.name || 'Product 2'}: ${product2Availability.message || 'No available keys'}`);
  }

  let cart = await Cart.findOne({ userId });
  if (!cart) {
    cart = await Cart.create({
      userId,
      items: [],
    });
  }

  const productIds = [product1._id, product2._id];

  for (const product of bundleDeal.products) {
    const existingItem = cart.items.find(
      (item) => item.productId.toString() === product._id.toString()
    );

    if (existingItem) {
      existingItem.qty += 1;
      existingItem.unitPrice = product.price;
    } else {
      cart.items.push({
        productId: product._id,
        sellerId: product.sellerId,
        qty: 1,
        unitPrice: product.price,
      });
    }
  }

  await cart.save();

  return res.status(200).json(
    new ApiResponse(true, cart, "Bundle added to cart successfully")
  );
});

export { addItemToCart, getCart, removeItemFromCart, clearCart, updateCart, addBundleToCart };
