import mongoose from "mongoose";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { Cart } from "../models/cart.model.js";
import { Product } from "../models/product.model.js";
import { BundleDeal } from "../models/bundledeal.model.js";
import { checkCartForBundle } from "../services/bundledeal.service.js";
import { checkKeyAvailability } from "../services/key.service.js";
import { calculateProductPrice } from "../utils/priceCalculator.js";
import { logger } from "../utils/logger.js";

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

  // Calculate product price with discounts
  let pricing;
  try {
    pricing = await calculateProductPrice(product);
  } catch (error) {
    logger.error(`Error calculating product price for product ${productId}:`, error);
    // Fallback to original price if calculation fails
    pricing = {
      originalPrice: product.price,
      discountedPrice: product.price,
      discountAmount: 0,
      discountPercentage: 0,
      discountType: null,
      discountSource: null,
      hasDiscount: false,
    };
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
          unitPrice: pricing.discountedPrice, // Use discounted price as unitPrice
          originalPrice: pricing.originalPrice,
          discountedPrice: pricing.discountedPrice,
          discountAmount: pricing.discountAmount,
          discountPercentage: pricing.discountPercentage,
          discountType: pricing.discountType,
          discountSource: pricing.discountSource,
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
      
      // Recalculate pricing in case discount changed
      let updatedPricing;
      try {
        updatedPricing = await calculateProductPrice(product);
      } catch (error) {
        logger.error(`Error recalculating product price for product ${productId}:`, error);
        updatedPricing = pricing; // Use previous pricing if recalculation fails
      }
      
      existingItem.qty = newQty;
      existingItem.unitPrice = updatedPricing.discountedPrice;
      existingItem.originalPrice = updatedPricing.originalPrice;
      existingItem.discountedPrice = updatedPricing.discountedPrice;
      existingItem.discountAmount = updatedPricing.discountAmount;
      existingItem.discountPercentage = updatedPricing.discountPercentage;
      existingItem.discountType = updatedPricing.discountType;
      existingItem.discountSource = updatedPricing.discountSource;
    } else {
      cart.items.push({
        productId,
        sellerId: product.sellerId,
        qty: requestedQty,
        unitPrice: pricing.discountedPrice, // Use discounted price as unitPrice
        originalPrice: pricing.originalPrice,
        discountedPrice: pricing.discountedPrice,
        discountAmount: pricing.discountAmount,
        discountPercentage: pricing.discountPercentage,
        discountType: pricing.discountType,
        discountSource: pricing.discountSource,
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
  let cart = await Cart.findOne({ userId }).populate("items.productId", "name images price discount slug").lean();

  // If cart doesn't exist, create an empty cart instead of throwing error
  if (!cart) {
    const newCart = await Cart.create({ userId, items: [] });
    cart = await Cart.findById(newCart._id).populate("items.productId", "name images price discount slug").lean();
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
      // Preserve all discount-related fields when cleaning up invalid items
      const validItemsForDB = validItems.map(item => ({
        productId: item.productId?._id || item.productId,
        sellerId: item.sellerId,
        qty: item.qty,
        unitPrice: item.unitPrice || item.discountedPrice || (item.productId?.price || 0),
        originalPrice: item.originalPrice || (item.productId?.price || 0),
        discountedPrice: item.discountedPrice || item.unitPrice || (item.productId?.price || 0),
        discountAmount: item.discountAmount || 0,
        discountPercentage: item.discountPercentage || 0,
        discountType: item.discountType || null,
        discountSource: item.discountSource || null,
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
  // Also recalculate prices to ensure discounts are up-to-date
  const cartItems = await Promise.all(
    validItems.map(async (item) => {
      // Safely get productId - handle both populated and non-populated cases
      const productId = item.productId?._id || item.productId;
      
      if (!productId) {
        return null; // Skip invalid items
      }

      const keyAvailability = await checkKeyAvailability(productId, item.qty);
      
      // Recalculate pricing to ensure discounts are current
      // Use stored prices as fallback if recalculation fails
      let currentPricing = {
        originalPrice: item.originalPrice || item.unitPrice || (item.productId?.price || 0),
        discountedPrice: item.discountedPrice || item.unitPrice || (item.productId?.price || 0),
        discountAmount: item.discountAmount || 0,
        discountPercentage: item.discountPercentage || 0,
        discountType: item.discountType || null,
        hasDiscount: (item.discountAmount || 0) > 0,
      };

      // Only recalculate if product is populated
      if (item.productId && typeof item.productId === 'object' && item.productId.price) {
        try {
          const recalculatedPricing = await calculateProductPrice(item.productId);
          // Update cart item if pricing changed (discount expired or new discount applied)
          if (recalculatedPricing.discountedPrice !== item.discountedPrice) {
            const cartDoc = await Cart.findById(cart._id);
            if (cartDoc) {
              const cartItem = cartDoc.items.find(
                ci => (ci.productId?.toString() || ci.productId) === productId.toString()
              );
              if (cartItem) {
                cartItem.unitPrice = recalculatedPricing.discountedPrice;
                cartItem.originalPrice = recalculatedPricing.originalPrice;
                cartItem.discountedPrice = recalculatedPricing.discountedPrice;
                cartItem.discountAmount = recalculatedPricing.discountAmount;
                cartItem.discountPercentage = recalculatedPricing.discountPercentage;
                cartItem.discountType = recalculatedPricing.discountType;
                cartItem.discountSource = recalculatedPricing.discountSource;
                await cartDoc.save();
              }
            }
          }
          currentPricing = recalculatedPricing;
        } catch (error) {
          logger.error(`Error recalculating price for cart item ${productId}:`, error);
          // Use stored pricing if recalculation fails
        }
      }

      return {
        product: item.productId,
        qty: item.qty,
        unitPrice: currentPricing.discountedPrice, // Use discounted price
        originalPrice: currentPricing.originalPrice,
        discountedPrice: currentPricing.discountedPrice,
        discountAmount: currentPricing.discountAmount,
        discountPercentage: currentPricing.discountPercentage,
        discountType: currentPricing.discountType,
        hasDiscount: currentPricing.hasDiscount,
        totalPrice: item.qty * currentPricing.discountedPrice,
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

    // Calculate pricing for each product in bundle
    let pricing;
    try {
      pricing = await calculateProductPrice(product);
    } catch (error) {
      logger.error(`Error calculating price for bundle product ${product._id}:`, error);
      pricing = {
        originalPrice: product.price,
        discountedPrice: product.price,
        discountAmount: 0,
        discountPercentage: 0,
        discountType: null,
        discountSource: null,
        hasDiscount: false,
      };
    }

    if (existingItem) {
      existingItem.qty += 1;
      existingItem.unitPrice = pricing.discountedPrice;
      existingItem.originalPrice = pricing.originalPrice;
      existingItem.discountedPrice = pricing.discountedPrice;
      existingItem.discountAmount = pricing.discountAmount;
      existingItem.discountPercentage = pricing.discountPercentage;
      existingItem.discountType = pricing.discountType;
      existingItem.discountSource = pricing.discountSource;
    } else {
      cart.items.push({
        productId: product._id,
        sellerId: product.sellerId,
        qty: 1,
        unitPrice: pricing.discountedPrice,
        originalPrice: pricing.originalPrice,
        discountedPrice: pricing.discountedPrice,
        discountAmount: pricing.discountAmount,
        discountPercentage: pricing.discountPercentage,
        discountType: pricing.discountType,
        discountSource: pricing.discountSource,
      });
    }
  }

  await cart.save();

  return res.status(200).json(
    new ApiResponse(true, cart, "Bundle added to cart successfully")
  );
});

export { addItemToCart, getCart, removeItemFromCart, clearCart, updateCart, addBundleToCart };
