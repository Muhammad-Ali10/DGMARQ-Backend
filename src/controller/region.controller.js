import mongoose from "mongoose";
import { asyncHandler } from "../utils/asyncHandler.js";
import { Region } from "../models/region.model.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";


// Purpose: Creates a new region with duplicate name checking
const createRegion = asyncHandler(async (req, res) => {
  const { name } = req.body;

  if (!name?.trim()) {
    throw new ApiError(400, "Region name is required");
  }

  const existingRegion = await Region.findOne({
    name: { $regex: `^${name}$`, $options: "i" },
  });
  if (existingRegion) {
    throw new ApiError(409, "Region already exists");
  }

  const region = await Region.create({ name: name.trim() });

  res
    .status(201)
    .json(new ApiResponse(201, region, "Region created successfully"));
});



// Purpose: Updates a region by ID with name validation
const updateRegion = asyncHandler(async (req, res) => {
  const { regionId } = req.params;
  const { name } = req.body;

  if (!mongoose.Types.ObjectId.isValid(regionId)) {
    throw new ApiError(400, "Invalid region ID");
  }

  if (!name?.trim()) {
    throw new ApiError(400, "Region name is required");
  }

  const region = await Region.findByIdAndUpdate(
    regionId,
    { name: name.trim() },
    { new: true }
  );

  if (!region) {
    throw new ApiError(404, "Region not found");
  }

  res
    .status(200)
    .json(new ApiResponse(200, region, "Region updated successfully"));
});


// Purpose: Deletes a region by ID
const deleteRegion = asyncHandler(async (req, res) => {
  const { regionId } = req.params;

  if (!mongoose.Types.ObjectId.isValid(regionId)) {
    throw new ApiError(400, "Invalid region ID");
  }

  const region = await Region.findByIdAndDelete(regionId);

  if (!region) {
    throw new ApiError(404, "Region not found");
  }

  res
    .status(200)
    .json(new ApiResponse(200, null, "Region deleted successfully"));
});



// Purpose: Retrieves all regions with pagination and optional search filtering
const getRegions = asyncHandler(async (req, res) => {
  const { page = 1, limit = 10, search = "" } = req.query;

  const query = {};

  if (search.trim()) {
    query.name = { $regex: search.trim(), $options: "i" };
  }

  const regionAggregate = Region.aggregate([
    { $match: query },
    { $sort: { createdAt: -1 } },
  ]);

  const options = {
    page: parseInt(page, 10),
    limit: parseInt(limit, 10),
  };

  const regions = await Region.aggregatePaginate(regionAggregate, options);

  res
    .status(200)
    .json(new ApiResponse(200, regions, "Regions fetched successfully"));
});



// Purpose: Retrieves a single region by ID
const getRegionById = asyncHandler(async (req, res) => {
  const { regionId } = req.params;

  if (!mongoose.Types.ObjectId.isValid(regionId)) {
    throw new ApiError(400, "Invalid region ID");
  }

  const region = await Region.findById(regionId);

  if (!region) {
    throw new ApiError(404, "Region not found");
  }

  res
    .status(200)
    .json(new ApiResponse(200, region, "Region fetched successfully"));
});
 
export{
  createRegion,
  updateRegion,
  deleteRegion,
  getRegions,
  getRegionById,
}; 
