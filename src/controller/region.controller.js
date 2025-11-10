import { asyncHandler } from "../utils/asyncHandler.js";
import { Region } from "../models/region.model.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { ApiResponse } from "../utils/ApiResponse.js";

const createRegion = asyncHandler(async (req, res) => {
  const { name } = req.body;

  if (!name) {
    return res
      .status(400)
      .json(new ApiResponse(400, null, "Region name is required"));
  }

  const regionExists = await Region.findOne({ name });

  if (regionExists) {
    return res
      .status(409)
      .json(new ApiResponse(409, null, "Region already exists"));
  }

  const region = await Region.create({ name });

  return res
    .status(201)
    .json(new ApiResponse(201, region, "Region created successfully"));
});

const updateRegion = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { name } = req.body;

  if (!name) {
    return res
      .status(400)
      .json(new ApiResponse(400, null, "Region name is required"));
  }

  const region = await Region.findByIdAndUpdate(id, { name }, { new: true });

  if (!region) {
    return res.status(404).json(new ApiResponse(404, null, "Region not found"));
  }

  return res
    .status(200)
    .json(new ApiResponse(200, region, "Region updated successfully"));
});
const deleteRegion = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const region = await Region.findByIdAndDelete(id);

  if (!region) {
    return res.status(404).json(new ApiResponse(404, null, "Region not found"));
  }

  return res
    .status(200)
    .json(new ApiResponse(200, null, "Region deleted successfully"));
});


const getRegions = asyncHandler(async (req, res) => {
  const { page = 1, limit = 5, search = "" } = req.query;

  const regionAggregate = await Region.find({
    name: { $regex: search, $options: "i" },
  })
    .skip((page - 1) * limit)
    .limit(parseInt(limit))
    .sort({ createdAt: -1 });

  const regions = await Region.aggregatePaginate(regionAggregate, {
    page: parseInt(page),
    limit: parseInt(limit),
  });

  return res
    .status(200)
    .json(new ApiResponse(200, regions, "Regions fetched successfully"));
});


export const getRegionsById = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const region = await Region.findById(id);

  if (!region) {
    return res.status(404).json(new ApiResponse(404, null, "Region not found"));
  }

  return res
    .status(200)
    .json(new ApiResponse(200, region, "Region fetched successfully"));
});

export { createRegion, updateRegion, deleteRegion, getRegions, getRegionsById };
