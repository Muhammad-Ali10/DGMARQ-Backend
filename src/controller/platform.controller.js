import mongoose from "mongoose";
import { Platform } from "../models/platform.model.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { asyncHandler } from "../utils/asyncHandler.js";


// Purpose: Creates a new platform with duplicate name checking
const createPlatform = asyncHandler(async (req, res) => {
  let { name, isActive = true } = req.body;

  if (!name) {
    throw new ApiError(400, "Platform name is required");
  }
  name = name.trim();

  const existingPlatform = await Platform.findOne({ name });
  if (existingPlatform) {
    throw new ApiError(409, "Platform already exists");
  }

  const platform = await Platform.create({ name, isActive });

  return res
    .status(201)
    .json(new ApiResponse(true, platform, "Platform created successfully"));
});


// Purpose: Updates a platform by ID with name validation
const updatePlatform = asyncHandler(async (req, res) => {
  const { id } = req.params;
  let { name } = req.body;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new ApiError(400, "Invalid platform ID");
  }

  if (!name) {
    throw new ApiError(400, "Platform name is required");
  }
  name = name.trim();

  const platform = await Platform.findByIdAndUpdate(
    id,
    { name },
    { new: true }
  );

  if (!platform) {
    throw new ApiError(404, "Platform not found");
  }

  return res
    .status(200)
    .json(new ApiResponse(true, platform, "Platform updated successfully"));
});


// Purpose: Toggles the active status of a platform
const togglePlatformStatus = asyncHandler(async (req, res) => {
  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new ApiError(400, "Invalid platform ID");
  }

  const platform = await Platform.findByIdAndUpdate(
    id,
    [{ $set: { isActive: { $not: "$isActive" } } }],
    { new: true }
  );

  if (!platform) {
    throw new ApiError(404, "Platform not found");
  }

  return res
    .status(200)
    .json(new ApiResponse(true, platform, "Platform status toggled successfully"));
});


// Purpose: Deletes a platform by ID
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
    .json(new ApiResponse(true, platform, "Platform deleted successfully"));
});


// Purpose: Retrieves all platforms with pagination and optional active status filtering
const getAllPlatforms = asyncHandler(async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 20;
  const skip = (page - 1) * limit;
  const filter = {};

  if (req.query.isActive !== undefined) {
    filter.isActive = req.query.isActive === "true";
  }

  const [platforms, total] = await Promise.all([
    Platform.find(filter).skip(skip).limit(limit).sort({ name: 1 }).lean(),
    Platform.countDocuments(filter),
  ]);

  return res.status(200).json(
    new ApiResponse(true, {
      total,
      page,
      limit,
      platforms,
    }, "Platforms retrieved successfully")
  );
});

export {
  createPlatform,
  updatePlatform,
  deletePlatform,
  getAllPlatforms,
  togglePlatformStatus,
};
