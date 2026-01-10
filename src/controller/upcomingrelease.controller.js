import mongoose from "mongoose";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { logger } from "../utils/logger.js";
import { UpcomingRelease } from "../models/upcomingrelease.model.js";
import { Product } from "../models/product.model.js";
import { fileUploader } from "../utils/cloudinary.js";
import { fileDelete } from "../utils/deletecloudinary.js";

/**
 * Get upcoming releases (public)
 * GET /api/v1/upcoming-release
 */
const getUpcomingReleases = asyncHandler(async (req, res) => {
  const config = await UpcomingRelease.getOrCreate();

  // Populate product details for active slots only
  const populatedSlots = await Promise.all(
    config.slots
      .filter((slot) => slot.productId && slot.backgroundImageUrl)
      .map(async (slot) => {
        const product = await Product.findById(slot.productId)
          .select("name slug price discount images platform region")
          .populate("platform", "name")
          .populate("region", "name")
          .lean();

        if (!product) {
          return null;
        }

        return {
          slotNumber: slot.slotNumber,
          product: {
            _id: product._id,
            name: product.name,
            slug: product.slug,
            price: product.price,
            discount: product.discount || 0,
            images: product.images || [],
            platform: product.platform,
            region: product.region,
          },
          backgroundImageUrl: slot.backgroundImageUrl,
        };
      })
  );

  const validSlots = populatedSlots.filter((slot) => slot !== null);

  return res.status(200).json(
    new ApiResponse(200, validSlots, "Upcoming releases retrieved successfully")
  );
});

/**
 * Get upcoming releases configuration (admin)
 * GET /api/v1/upcoming-release/admin
 */
const getUpcomingReleasesConfig = asyncHandler(async (req, res) => {
  const config = await UpcomingRelease.getOrCreate();

  // Populate product details
  const populatedSlots = await Promise.all(
    config.slots.map(async (slot) => {
      let product = null;
      if (slot.productId) {
        product = await Product.findById(slot.productId)
          .select("name slug price images platform region")
          .populate("platform", "name")
          .populate("region", "name")
          .lean();
      }

      return {
        slotNumber: slot.slotNumber,
        productId: slot.productId,
        product: product,
        backgroundImageUrl: slot.backgroundImageUrl,
        backgroundImagePublicId: slot.backgroundImagePublicId,
        createdAt: slot.createdAt,
        updatedAt: slot.updatedAt,
      };
    })
  );

  return res.status(200).json(
    new ApiResponse(200, { slots: populatedSlots }, "Upcoming releases configuration retrieved successfully")
  );
});

/**
 * Update slot (admin)
 * PUT /api/v1/upcoming-release/slot/:slotNumber
 */
const updateSlot = asyncHandler(async (req, res) => {
  const { slotNumber } = req.params;
  const { productId } = req.body;

  const slotNum = parseInt(slotNumber);
  if (![1, 2].includes(slotNum)) {
    throw new ApiError(400, "Slot number must be 1 or 2");
  }

  if (!mongoose.Types.ObjectId.isValid(productId)) {
    throw new ApiError(400, "Invalid product ID");
  }

  // Verify product exists
  const product = await Product.findById(productId);
  if (!product) {
    throw new ApiError(404, "Product not found");
  }

  // Get or create config
  const config = await UpcomingRelease.getOrCreate();

  // Find the slot
  let slotIndex = config.slots.findIndex((s) => s.slotNumber === slotNum);
  if (slotIndex === -1) {
    // Create new slot if doesn't exist
    config.slots.push({
      slotNumber: slotNum,
      productId: productId,
      backgroundImageUrl: config.slots.find(s => s.slotNumber === slotNum)?.backgroundImageUrl || "",
      backgroundImagePublicId: config.slots.find(s => s.slotNumber === slotNum)?.backgroundImagePublicId || null,
      updatedAt: new Date(),
    });
    slotIndex = config.slots.length - 1;
  } else {
    // Update existing slot
    config.slots[slotIndex].productId = productId;
    config.slots[slotIndex].updatedAt = new Date();
  }

  await config.save();

  // Populate and return updated slot
  const updatedSlot = config.slots.find((s) => s.slotNumber === slotNum);
  const populatedProduct = await Product.findById(updatedSlot.productId)
    .select("name slug price images platform region")
    .populate("platform", "name")
    .populate("region", "name")
    .lean();

  return res.status(200).json(
    new ApiResponse(200, {
      slotNumber: updatedSlot.slotNumber,
      productId: updatedSlot.productId,
      product: populatedProduct,
      backgroundImageUrl: updatedSlot.backgroundImageUrl,
      backgroundImagePublicId: updatedSlot.backgroundImagePublicId,
    }, "Slot updated successfully")
  );
});

/**
 * Update slot background image (admin)
 * PUT /api/v1/upcoming-release/slot/:slotNumber/image
 */
const updateSlotImage = asyncHandler(async (req, res) => {
  const { slotNumber } = req.params;
  const slotNum = parseInt(slotNumber);

  if (![1, 2].includes(slotNum)) {
    throw new ApiError(400, "Slot number must be 1 or 2");
  }

  if (!req.file) {
    throw new ApiError(400, "Background image is required");
  }

  // Get or create config
  const config = await UpcomingRelease.getOrCreate();

  // Find the slot
  const slotIndex = config.slots.findIndex((s) => s.slotNumber === slotNum);
  if (slotIndex === -1) {
    throw new ApiError(404, `Slot ${slotNum} not found. Please set a product first.`);
  }

  const slot = config.slots[slotIndex];

  // Delete old image from cloudinary if exists
  if (slot.backgroundImagePublicId) {
    try {
      await fileDelete(slot.backgroundImagePublicId, "image");
    } catch (error) {
      logger.error("Error deleting old image", error);
      // Continue even if deletion fails
    }
  }

  // Upload new image
  const uploadResult = await fileUploader(req.file.path);
  if (!uploadResult || !uploadResult.url) {
    throw new ApiError(500, "Failed to upload background image");
  }

  // Update slot
  slot.backgroundImageUrl = uploadResult.url;
  slot.backgroundImagePublicId = uploadResult.public_id;
  slot.updatedAt = new Date();

  await config.save();

  // Populate product if exists
  let populatedProduct = null;
  if (slot.productId) {
    populatedProduct = await Product.findById(slot.productId)
      .select("name slug price images platform region")
      .populate("platform", "name")
      .populate("region", "name")
      .lean();
  }

  return res.status(200).json(
    new ApiResponse(200, {
      slotNumber: slot.slotNumber,
      productId: slot.productId,
      product: populatedProduct,
      backgroundImageUrl: slot.backgroundImageUrl,
      backgroundImagePublicId: slot.backgroundImagePublicId,
    }, "Slot image updated successfully")
  );
});

export {
  getUpcomingReleases,
  getUpcomingReleasesConfig,
  updateSlot,
  updateSlotImage,
};

