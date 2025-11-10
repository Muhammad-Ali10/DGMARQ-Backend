import mongoose from "mongoose";
import { Device } from "../models/device.model.js";
import { ApiError } from "../utils/ApiError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiResponse } from "../utils/ApiResponse.js";

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

const getDevices = asyncHandler(async (req, res) => {
  const devices = await Device.find();

  return res
    .status(200)
    .json(new ApiResponse(200, devices, "Devices fetched successfully"));
});

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