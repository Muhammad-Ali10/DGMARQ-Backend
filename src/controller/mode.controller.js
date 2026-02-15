import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { Mode } from "../models/mode.model.js";
import mongoose from "mongoose";

const createMode = asyncHandler(async (req, res) => {
  const { name, isActive } = req.body;

  if (!name || !name.trim()) {
    throw new ApiError(400, "Mode name is required");
  }

  const existing = await Mode.findOne({
    name: { $regex: `^${name}$`, $options: "i" },
  });
  if (existing) {
    throw new ApiError(400, "Mode with this name already exists");
  }

  const mode = await Mode.create({ name: name.trim(), isActive });

  if (!mode) {
    throw new ApiError(500, "Something went wrong while creating mode");
  }

  res.status(201).json(new ApiResponse(201, mode, "Mode created successfully"));
});

const updateMode = asyncHandler(async (req, res) => {
  const { modeId } = req.params;
  const { name, isActive } = req.body;

  if (!mongoose.Types.ObjectId.isValid(modeId)) {
    throw new ApiError(400, "Invalid Mode ID");
  }

  if (!name || !name.trim()) {
    throw new ApiError(400, "Mode name is required");
  }

  const existingmode = await Mode.findOne({
    name: { $regex: `^${name}$`, $options: "i" },
    _id: { $ne: new mongoose.Types.ObjectId(modeId) },
  });

  if (existingmode)
    throw new ApiError(409, "Mode with this name already exists");

  const mode = await Mode.findByIdAndUpdate(
    modeId,
    { name: name.trim(), isActive },
    { new: true }
  );

  if (!mode) {
    throw new ApiError(404, "Mode not found");
  }

  res.status(200).json(new ApiResponse(200, mode, "Mode updated successfully"));
});

const toggleModeStatus = asyncHandler(async (req, res) => {
  const { modeId } = req.params;

  if (!mongoose.Types.ObjectId.isValid(modeId)) {
    throw new ApiError(400, "Invalid Mode ID");
  }

  const mode = await Mode.findById(modeId);
  if (!mode) {
    throw new ApiError(404, "Mode not found");
  }

  mode.isActive = !mode.isActive;
  await mode.save();

  res
    .status(200)
    .json(new ApiResponse(200, mode, "Mode status toggled successfully"));
});

const deleteMode = asyncHandler(async (req, res) => {
  const { modeId } = req.params;

  if (!mongoose.Types.ObjectId.isValid(modeId)) {
    throw new ApiError(400, "Invalid Mode ID");
  }

  const mode = await Mode.findByIdAndDelete(modeId);

  if (!mode) {
    throw new ApiError(404, "Mode not found");
  }

  res.status(200).json(new ApiResponse(200, mode, "Mode deleted successfully"));
});

const getAllModes = asyncHandler(async (req, res) => {
  const { page = 1, limit = 10, search = "", isActive } = req.query;

  const match = {};
  if (search.trim()) {
    match.name = { $regex: search.trim(), $options: "i" };
  }

  if (isActive !== undefined) {
    match.isActive = isActive === "true";
  }

  const aggregate = Mode.aggregate([
    { $match: match },
    { $sort: { createdAt: -1 } },
  ]);

  const options = {
    page: parseInt(page),
    limit: parseInt(limit),
  };

  const result = await Mode.aggregatePaginate(aggregate, options);

  res
    .status(200)
    .json(new ApiResponse(200, result, "Modes fetched successfully"));
});

export { createMode, updateMode, toggleModeStatus, deleteMode, getAllModes };
