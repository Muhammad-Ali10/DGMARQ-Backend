import mongoose from "mongoose";
import { asyncHandler } from "../utils/asyncHandler.js";
import { Theme } from "../models/theme.model.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";

// Purpose: Creates a new theme with duplicate name checking
const createTheme = asyncHandler(async (req, res) => {
  const { name } = req.body;

  if (!name) {
    throw new ApiError(400, "Theme name is required");
  }

  const existingTheme = await Theme.findOne({ name: name.trim() });

  if (existingTheme) {
    throw new ApiError(409, "Theme already exists");
  }
  const theme = await Theme.create({ name: name.trim() });

  if (!theme) {
    throw new ApiError(500, "Something went wrong while creating theme");
  }
  res
    .status(201)
    .json(new ApiResponse(201, theme, "Theme created successfully"));
});

// Purpose: Updates a theme by ID with duplicate name validation
const updateTheme = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { name } = req.body;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new ApiError(400, "Invalid theme ID");
  }

  if (!name) {
    throw new ApiError(400, "Theme name is required");
  }

  const existingTheme = await Theme.findOne({
    name: name.trim(),
    _id: { $ne: id },
  });

  if (existingTheme) {
    throw new ApiError(409, "Another theme with the same name already exists");
  }
  const theme = await Theme.findByIdAndUpdate(
    id,
    { name: name.trim() },
    { new: true }
  );

  if (!theme) {
    throw new ApiError(404, "Theme not found");
  }
  res
    .status(200)
    .json(new ApiResponse(200, theme, "Theme updated successfully"));
});

// Purpose: Deletes a theme by ID
const deleteTheme = asyncHandler(async (req, res) => {
  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new ApiError(400, "Invalid theme ID");
  }
  const theme = await Theme.findByIdAndDelete(id);
  if (!theme) {
    throw new ApiError(404, "Theme not found");
  }
  res
    .status(200)
    .json(new ApiResponse(200, theme, "Theme deleted successfully"));
});

// Purpose: Retrieves all themes with pagination and optional search filtering
const getThemes = asyncHandler(async (req, res) => {
  const { page = 1, limit = 10, search = "" } = req.query;

  const match = {};

  if (search) {
    match.name = { $regex: search, $options: "i" };
  }

  const aggregate = Theme.aggregate([
    { $match: match },
    { $sort: { createdAt: -1 } },
  ]);

  const options = {
    page: parseInt(page),
    limit: parseInt(limit),
  };

  const result = await Theme.aggregatePaginate(aggregate, options);

  res
    .status(200)
    .json(new ApiResponse(200, result, "Themes retrieved successfully"));
});

export { createTheme, updateTheme, deleteTheme, getThemes };
