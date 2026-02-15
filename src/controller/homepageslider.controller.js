import mongoose from "mongoose";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { HomepageSlider } from "../models/homepageslider.model.js";
import { Product } from "../models/product.model.js";
import { getActiveSliders, validateSliderData } from "../services/homepageslider.service.js";
import { upload } from "../middlerwares/multer.middlerware.js";
import { fileUploader } from "../utils/cloudinary.js";

const createHomepageSlider = asyncHandler(async (req, res) => {
  const { title, productId, link, order, slideIndex } = req.body;

  if (!title) {
    throw new ApiError(400, "Title is required");
  }

  const validation = await validateSliderData({ productId, link });
  if (!validation.valid) {
    throw new ApiError(400, validation.error);
  }

  if (!req.file) {
    throw new ApiError(400, "Image is required");
  }

  const uploadResult = await fileUploader(req.file.path);
  const imageUrl = uploadResult.url;

  let finalSlideIndex = slideIndex !== undefined ? parseInt(slideIndex) : 0;
  if (isNaN(finalSlideIndex)) {
    finalSlideIndex = 0;
  }

  if (finalSlideIndex < 0 || finalSlideIndex > 4) {
    finalSlideIndex = 0;
  }

  const slider = await HomepageSlider.create({
    title,
    image: imageUrl,
    productId: productId ? new mongoose.Types.ObjectId(productId) : null,
    link: link || null,
    slideIndex: finalSlideIndex,
    order: order || finalSlideIndex,
    isActive: true,
  });

  const populated = await HomepageSlider.findById(slider._id)
    .populate("productId", "name slug price images");

  return res.status(201).json(
    new ApiResponse(201, populated, "Homepage slider created successfully")
  );
});

const getHomepageSliders = asyncHandler(async (req, res) => {
  const sliders = await getActiveSliders();

  return res.status(200).json(
    new ApiResponse(200, sliders, "Homepage sliders retrieved successfully")
  );
});

const getHomepageSliderById = asyncHandler(async (req, res) => {
  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new ApiError(400, "Invalid slider ID");
  }

  const slider = await HomepageSlider.findById(id).populate("productId", "name slug price images description");

  if (!slider) {
    throw new ApiError(404, "Homepage slider not found");
  }

  return res.status(200).json(
    new ApiResponse(200, slider, "Homepage slider retrieved successfully")
  );
});

const updateHomepageSlider = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { title, productId, link, order, isActive, slideIndex } = req.body;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new ApiError(400, "Invalid slider ID");
  }

  const slider = await HomepageSlider.findById(id);
  if (!slider) {
    throw new ApiError(404, "Homepage slider not found");
  }

  if (title !== undefined) {
    slider.title = title;
  }

  if (productId !== undefined || link !== undefined) {
    const validation = await validateSliderData({
      productId: productId !== undefined ? productId : slider.productId,
      link: link !== undefined ? link : slider.link,
    });
    if (!validation.valid) {
      throw new ApiError(400, validation.error);
    }

    if (productId !== undefined) {
      slider.productId = productId ? new mongoose.Types.ObjectId(productId) : null;
    }
    if (link !== undefined) {
      slider.link = link;
    }
  }

  if (order !== undefined) {
    slider.order = order;
  }

  if (slideIndex !== undefined) {
    const finalSlideIndex = parseInt(slideIndex);
    if (!isNaN(finalSlideIndex) && finalSlideIndex >= 0 && finalSlideIndex <= 4) {
      slider.slideIndex = finalSlideIndex;
    }
  }

  if (req.file) {
    const uploadResult = await fileUploader(req.file.path);
    slider.image = uploadResult.url;
  }

  if (isActive !== undefined) {
    slider.isActive = isActive;
  }

  await slider.save();

  const populated = await HomepageSlider.findById(slider._id)
    .populate("productId", "name slug price images");

  return res.status(200).json(
    new ApiResponse(200, populated, "Homepage slider updated successfully")
  );
});

const deleteHomepageSlider = asyncHandler(async (req, res) => {
  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new ApiError(400, "Invalid slider ID");
  }

  const slider = await HomepageSlider.findById(id);
  if (!slider) {
    throw new ApiError(404, "Homepage slider not found");
  }

  await slider.deleteOne();

  return res.status(200).json(
    new ApiResponse(200, null, "Homepage slider deleted successfully")
  );
});

const getAllHomepageSliders = asyncHandler(async (req, res) => {
  const { page = 1, limit = 10, isActive } = req.query;

  const match = {};
  if (isActive !== undefined) {
    match.isActive = isActive === 'true';
  }

  const skip = (parseInt(page) - 1) * parseInt(limit);

  const sliders = await HomepageSlider.find(match)
    .populate("productId", "name slug price images")
    .sort({ slideIndex: 1, order: 1, createdAt: -1 })
    .skip(skip)
    .limit(parseInt(limit));

  const total = await HomepageSlider.countDocuments(match);

  return res.status(200).json(
    new ApiResponse(200, {
      sliders,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit)),
      },
    }, "Homepage sliders retrieved successfully")
  );
});

export {
  createHomepageSlider,
  getHomepageSliders,
  getHomepageSliderById,
  updateHomepageSlider,
  deleteHomepageSlider,
  getAllHomepageSliders,
};

