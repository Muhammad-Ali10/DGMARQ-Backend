import mongoose from "mongoose";
import { Platform } from "../models/platform.model";
import { ApiError } from "../utils/ApiError";
import { ApiResponse } from "../utils/ApiResponse";
import { asyncHandler } from "../utils/asyncHandler";

// Create a new platform
const createPlatform = asyncHandler(async (req, res) => {
  const { name, isActive } = req.body;

  if (!name) {
    throw new ApiError(400, "Platform name is required");
  }
  const existingPlatform = await Platform.findOne({ name });

  if (existingPlatform) {
    throw new ApiError(409, "Platform already exists");
  }

  const platform = await Platform.create({ name, isActive });

  return res
    .status(201)
    .json(new ApiResponse(201, platform, "Platform created successfully"));
});

// Update an existing platform
const updatePlatform = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { name, isActive } = req.body;
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new ApiError(400, "Invalid platform ID");
  }

  if (!name) {
    throw new ApiError(400, "Platform name is required");
  }

  const platform = await Platform.findByIdAndUpdate(
    id,
    { name, isActive },
    { new: true }
  );

  if (!platform) {
    throw new ApiError(404, "Platform not found");
  }

  return res
    .status(200)
    .json(new ApiResponse(200, platform, "Platform updated successfully"));
});


const togglePlatformStatus = asyncHandler(async (req, res) => {
  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new ApiError(400, "Invalid platform ID");
  }
  const platform = await Platform.findByIdAndUpdate(
    id,
    { isActive: !platform.isActive },
    { new: true }
  );

  if (!platform) {
    throw new ApiError(404, "Platform not found");
  }

  return res
    .status(200)
    .json(new ApiResponse(200, platform, "Platform status toggled successfully"));
});

const deletePlatform = asyncHandler(async (req, res) => {
  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new ApiError(400, "Invalid platform ID");
  }

  const platform = await Platform.findByIdAndDelete(id);

  if (!platform) {
    throw new ApiError(404, "Platform not found");
  }

  return res
    .status(200)
    .json(new ApiResponse(200, platform, "Platform deleted successfully"));
});


const getAllPlatforms = asyncHandler(async (req, res) => {

  const platforms = await Platform.find();

  return res
    .status(200)
    .json(new ApiResponse(200, platforms, "Platforms retrieved successfully"));
});


export {
  createPlatform,
  updatePlatform,
  deletePlatform,
  getAllPlatforms,
  togglePlatformStatus
};