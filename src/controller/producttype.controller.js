import { asyncHandler } from "../utils/asyncHandler.js";
import { ProductType } from "../models/producttype.model.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import mongoose from "mongoose";

const createProductType = asyncHandler(async (req, res) => {
  const { name } = req.body;

  if (!name?.trim()) throw new ApiError(400, "Product type name is required");

  const exists = await ProductType.findOne({ name: name.trim() });
  if (exists) throw new ApiError(409, "Product type already exists");

  const productType = await ProductType.create({ name: name.trim() });

  res
    .status(201)
    .json(new ApiResponse(201, productType, "Product type created successfully"));
});

const updateProductType = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { name } = req.body;

  if (!mongoose.Types.ObjectId.isValid(id))
    throw new ApiError(400, "Invalid product type ID");

  if (!name?.trim()) throw new ApiError(400, "Product type name is required");

  const exists = await ProductType.findOne({ name: name.trim(), _id: { $ne: id } });
  if (exists) throw new ApiError(409, "Product type already exists");

  const productType = await ProductType.findByIdAndUpdate(
    id,
    { name: name.trim() },
    { new: true }
  );

  if (!productType) throw new ApiError(404, "Product type not found");

  res
    .status(200)
    .json(new ApiResponse(200, productType, "Product type updated successfully"));
});

const getAllProductTypes = asyncHandler(async (req, res) => {
  const { page = 1, limit = 10, search = "" } = req.query;

  const match = {};
  if (search.trim()) {
    match.name = { $regex: search.trim(), $options: "i" };
  }

  const aggregate = ProductType.aggregate([
    { $match: match },
    { $sort: { createdAt: -1 } },
  ]);

  const options = {
    page: parseInt(page),
    limit: parseInt(limit),
  };

  const result = await ProductType.aggregatePaginate(aggregate, options);

  res
    .status(200)
    .json(new ApiResponse(200, result, "Product types fetched successfully"));
});

const deleteProductType = asyncHandler(async (req, res) => {
  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id))
    throw new ApiError(400, "Invalid product type ID");

  const productType = await ProductType.findByIdAndDelete(id);

  if (!productType) throw new ApiError(404, "Product type not found");

  res
    .status(200)
    .json(new ApiResponse(200, null, "Product type deleted successfully"));
});

const toggleProductTypeStatus = asyncHandler(async (req, res) => {
  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id))
    throw new ApiError(400, "Invalid product type ID");

  const productType = await ProductType.findById(id);
  if (!productType) throw new ApiError(404, "Product type not found");

  productType.isActive = !productType.isActive;
  await productType.save();

  res
    .status(200)
    .json(
      new ApiResponse(
        200,
        productType,
        "Product type status toggled successfully"
      )
    );
});

export {
  createProductType,
  updateProductType,
  getAllProductTypes,
  deleteProductType,
  toggleProductTypeStatus,
};
