import { asyncHandler } from "../utils/asyncHandler.js";
import { Type } from "../models/type.model.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import mongoose from "mongoose";

// Creates a new product type with duplicate name checking
const createType = asyncHandler(async (req, res) => {
  const { name } = req.body;

  if (!name?.trim()) throw new ApiError(400, "Product type name is required");

  const exists = await Type.findOne({ name: name.trim() });
  if (exists) throw new ApiError(409, "Product type already exists");

  const  CreatedType = await Type.create({ name: name.trim() });

  res
    .status(201)
    .json(new ApiResponse(201, CreatedType, "Product type created successfully"));
});

// Updates a product type by ID with duplicate name validation
const updateType = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { name } = req.body;

  if (!mongoose.Types.ObjectId.isValid(id))
    throw new ApiError(400, "Invalid product type ID");

  if (!name?.trim()) throw new ApiError(400, "Product type name is required");

  const exists = await Type.findOne({ name: name.trim(), _id: { $ne: id } });
  if (exists) throw new ApiError(409, "Product type already exists");

  const updatedType = await Type.findByIdAndUpdate(
    id,
    { name: name.trim() },
    { new: true }
  );

  if (!updatedType) throw new ApiError(404, "Product type not found");

  res
    .status(200)
    .json(new ApiResponse(200, updatedType, "Product type updated successfully"));
});

// Retrieves all product types with pagination and optional search filtering
const getAllTypes = asyncHandler(async (req, res) => {
  const { page = 1, limit = 10, search = "" } = req.query;

  const match = {};
  if (search.trim()) {
    match.name = { $regex: search.trim(), $options: "i" };
  }

  const aggregate = Type.aggregate([
    { $match: match },
    { $sort: { createdAt: -1 } },
  ]);

  const options = {
    page: parseInt(page),
    limit: parseInt(limit),
  };

  const result = await Type.aggregatePaginate(aggregate, options);

  res
    .status(200)
    .json(new ApiResponse(200, result, "Product types fetched successfully"));
});

// Deletes a product type by ID
const deleteType = asyncHandler(async (req, res) => {
  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id))
    throw new ApiError(400, "Invalid product type ID");

  const deletedType = await Type.findByIdAndDelete(id);

  if (!deletedType) throw new ApiError(404, "Product type not found");

  res
    .status(200)
    .json(new ApiResponse(200, null, "Product type deleted successfully"));
});

// Toggles the active status of a product type
const toggleTypeStatus = asyncHandler(async (req, res) => {
  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id))
    throw new ApiError(400, "Invalid product type ID");

  const type = await Type.findById(id);
  if (!type) throw new ApiError(404, "Product type not found");

  type.isActive = !type.isActive;
  await type.save();

  res
    .status(200)
    .json(
      new ApiResponse(
        200,
        type,
        "Product type status toggled successfully"
      )
    );
});

export {
  createType,
  updateType,
  getAllTypes,
  deleteType,
  toggleTypeStatus,
};
