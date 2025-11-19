import mongoose from "mongoose";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { Cart } from "../models/cart.model.js";
import { Product } from "../models/product.model.js";

// Add Item to Cart
const addItemToCart = asyncHandler(async (req, res) => {
  const userId = req.user;
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

  if (product.stock < (qty || 1)) {
    throw new ApiError(400, "Insufficient stock for the product");
  }

  let cart = await Cart.findOne({ userId });
  if (!cart) {
    cart = await Cart.create({
      userId,
      items: [
        {
          productId,
          sellerId: product.sellerId,
          qty: qty || 1,
          unitPrice: product.price,
        },
      ],
    });
  }

  const existingItem = cart.items.find(
    (item) => item.productId.toString() === productId
  );

  if (existingItem) {
    existingItem.qty += qty || 1;
    existingItem.unitPrice = product.price;
  } else {
    cart.items.push({
      productId,
      sellerId: product.sellerId,
      qty: qty || 1,
      unitPrice: product.price,
    });
  }

  await cart.save();

  return res
    .status(200)
    .json(new ApiResponse(true, cart,"Item added to cart"));
});

const getCart = asyncHandler(async (req, res) => {
  const userId = req.user;
  const cart = await Cart.findOne({ userId }).populate("items.productId");

  if (!cart) {
    throw new ApiError(404, "Cart not found");
  }

  const cartItems = cart.items.map((item) => ({
    product: item.productId,
    qty: item.qty,
    unitPrice: item.unitPrice,
    totalPrice: item.qty * item.unitPrice,
  }));

  const total = cartItems.reduce((acc, item) => acc + item.totalPrice, 0);

  return res.status(200).json(
    new ApiResponse(true,  {
      items: cartItems,
      total,
    },"Cart retrieved successfully")
  );
});

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

  item.qty = qty;
  await cart.save();

  return res
    .status(200)
    .json(new ApiResponse(true, cart,"Cart updated successfully" ));
});

export { addItemToCart, getCart, removeItemFromCart, clearCart, updateCart };
