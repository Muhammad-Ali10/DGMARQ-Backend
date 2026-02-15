import mongoose from "mongoose";
import { Device } from "../models/device.model.js";
import { ApiError } from "../utils/ApiError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiResponse } from "../utils/ApiResponse.js";

/** Creates device with duplicate name check. */
const createDevice = asyncHandler(async (req, res) => {
  const { name, isActive } = req.body;

  if (!name) {
    throw new ApiError(400, "Device name is required");
  }
  const existingDevice = await Device.findOne({ name });

  if (existingDevice) {
    throw new ApiError(409, "Device already exists");
  }

  const device = await Device.create({ name, isActive });

  return res
    .status(201)
    .json(new ApiResponse(201, device, "Device created successfully"));
});

/** Retrieves devices with pagination, search, and optional isActive filter. */
const getDevices = asyncHandler(async (req, res) => {
  const { page = 1, limit = 10, search = "", isActive } = req.query;

  const match = {};
  if (search.trim()) {
    match.name = { $regex: search.trim(), $options: "i" };
  }

  if (isActive !== undefined) {
    match.isActive = isActive === "true";
  }

  const aggregate = Device.aggregate([
    { $match: match },
    { $sort: { createdAt: -1 } },
  ]);

  const options = {
    page: parseInt(page, 10),
    limit: parseInt(limit, 10),
  };

  const result = await Device.aggregatePaginate(aggregate, options);

  return res
    .status(200)
    .json(new ApiResponse(200, result, "Devices fetched successfully"));
});

/** Retrieves device by ID. */
const getDeviceById = asyncHandler(async (req, res) => {
  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new ApiError(400, "Invalid Device Id");
  }

  const device = await Device.findById(id);

  if (!device) {
    throw new ApiError(404, "Device not found");
  }

  return res
    .status(200)
    .json(new ApiResponse(200, device, "Device fetched successfully"));
});

/** Updates device name and active status. */
const updateDevice = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { name, isActive } = req.body;
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new ApiError(400, "Invalid Device Id");
  }
  const device = await Device.findByIdAndUpdate(
    id,
    { name, isActive },
    { new: true }
  );

  if (!device) {
    throw new ApiError(404, "Device not found");
  }

  return res
    .status(200)
    .json(new ApiResponse(200, device, "Device updated successfully"));
});

/** Deletes device by ID. */
const deleteDevice = asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new ApiError(400, "Invalid Device Id");
  }
  const device = await Device.findByIdAndDelete(id);

  if (!device) {
    throw new ApiError(404, "Device not found");
  }

  return res
    .status(200)
    .json(new ApiResponse(200, {}, "Device deleted successfully"));
});

/** Toggles device active status. */
const toggleDeviceStatus = asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new ApiError(400, "Invalid Device Id");
  }
  const device = await Device.findById(id);

  if (!device) {
    throw new ApiError(404, "Device not found");
  }

  device.isActive = !device.isActive;
  await device.save();
  return res
    .status(200)
    .json(new ApiResponse(200, device, "Device status updated successfully"));
});


export {
  createDevice,
  getDevices,
  getDeviceById,
  updateDevice,
  deleteDevice,
  toggleDeviceStatus
} 