import mongoose from "mongoose";
import { SubCategory } from "../models/subcategory.model.js";
import { Category } from "../models/category.model.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { fileUploader } from "../utils/cloudinary.js";


const createSubCategory = asyncHandler(async (req, res) => {

    const { name, slug, parentCategory, description } = req.body;
    const localimagePath = req.file.path;

    if (!name || !slug || !parentCategory) {
        throw new ApiError(400, "All fields are required");
    }

    if (!mongoose.Types.ObjectId.isValid(parentCategory)) {
        throw new ApiError(400, "Invalid parent category ID");
    }

    const existingSubCategory = await SubCategory.findOne({ $or: [{ slug }, { name }] })

    if (existingSubCategory) {
        throw new ApiError(409, "Sub category with this name or slug already exists");
    }

    if (!localimagePath) {
        throw new ApiError(400, "All fields are required");
    }

    const subCategoryImage = await fileUploader(localimagePath);

    if (!subCategoryImage) {
        throw new ApiError(500, "Some thing went wrong");
    }

    const isParentCategoryExists = await Category.findById(parentCategory);

    if (!isParentCategoryExists) {
        throw new ApiError(404, "Parent category not found");
    }

    const subCategory = await SubCategory.create({
        name,
        slug,
        parentCategory,
        image: subCategoryImage.url,
        description
    });

    return res.status(201).json(new ApiResponse(201, subCategory, "Sub category created successfully"));

})


const getSubCategoryById = asyncHandler(async (req, res) => {

    const { subCategoryId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(subCategoryId)) {
        throw new ApiError(400, "Invalid Sub Category Id")
    }
    const subCategory = await SubCategory.findById(subCategoryId);

    if (!subCategory) {
        throw new ApiError(404, "Sub category not found");
    }

    return res.status(200).json(new ApiResponse(200, subCategory, "Sub category fetched successfully"));
})


const updateSubCategory = asyncHandler(async (req, res) => {

    const { subCategoryId } = req.params;
    const { name, slug, parentCategory, description } = req.body;

    if (!mongoose.Types.ObjectId.isValid(subCategoryId)) {
        throw new ApiError(400, "Invalid Sub Category Id");

    }

    const isSubCategoryExists = await SubCategory.findOne({
        $or: [{ name }, { slug }],
        _id: { $ne: new mongoose.Types.ObjectId(subCategoryId) },
    });

    if (isSubCategoryExists) {
        throw new ApiError(409, "Sub category with this name or slug already exists")
    }

    const subCategory = await SubCategory.findByIdAndUpdate(subCategoryId,
        { name, slug, parentCategory, description },
        { new: true });

    if (!subCategory) throw new ApiError(404, "Sub category not found");

    return res.status(200).json(new ApiResponse(200, subCategory, "Sub category updated successfully"));

})

const updateSubCategoryImage = asyncHandler(async (req, res) => {

    const { subCategoryId } = req.params;

    const localimagePath = req.file.path

    if (!localimagePath) {
        throw new ApiError(400, "Image is required")
    }
    const subCategoryImage = await fileUploader(localimagePath);

    if (!subCategoryImage) {
        throw new ApiError(500, "Some thing went wrong");
    }

    const subCategory = await SubCategory.findByIdAndUpdate(subCategoryId,
        { image: subCategoryImage.url },
        { new: true });

    if (!subCategory) {
        throw new ApiError(404, "Sub category not found")
    }

    return res.status(200).json(new ApiResponse(200, subCategory, "Sub category image updated successfully"));

})

const updateSubCategoryStatus = asyncHandler(async (req, res) => {

    const { subCategoryId } = req.params;
    const { status } = req.body;

    if (!mongoose.Types.ObjectId.isValid(subCategoryId)) {
        throw new ApiError(400, "Invalid Sub Category ID");
    }

    if (typeof status !== "boolean") {
        throw new ApiError(400, "Status must be a boolean (true or false)");
    }

    const subCategory = await SubCategory.findByIdAndUpdate(
        subCategoryId,
        { isActive: status },
        { new: true }
    );

    return res
        .status(200)
        .json(new ApiResponse(200, subCategory, "Sub category status updated successfully"));


})

const getSubcategories = asyncHandler(async (req, res) => {

    const { page = 1, limit = 10, search = "", isActive } = req.query;

    const match = {};

    if (search.trim()) {
        match.name = { $regex: search, $options: "i" };
    }

    if (isActive !== undefined) {
        match.isActive = isActive === "true";
    }

    const subCategoryAggregate = SubCategory.aggregate([
        { $match: match },
        { $sort: { createdAt: -1 } },
        {
            $lookup: {
                from: "categories",
                localField: "parentCategory",
                foreignField: "_id",
                as: "parentCategory",
            }
        },
        {
            $unwind: {
                path: "$parentCategory",
                preserveNullAndEmptyArrays: true
            }
        },
        {
            $project: {
                name: 1,
                slug: 1,
                image: 1,
                isActive: 1,
                "parentCategory._id": 1,
                "parentCategory.name": 1,
                createdAt: 1,
            },
        },
    ]);

    const subCategories = await SubCategory.aggregatePaginate(
        subCategoryAggregate,
        {
            page: parseInt(page),
            limit: parseInt(limit),
        })
    return res
        .status(200)
        .json(new ApiResponse(200, subCategories, "Sub categories fetched successfully"));



})

const deleteSubcategory =  asyncHandler(async (req, res) => {

    const { subCategoryId } = req.params

    if(!mongoose.Types.ObjectId.isValid(subCategoryId))
    {
        throw new ApiError(400, "Invalid Sub Category Id")
    }
    const subCategory = await SubCategory.findByIdAndDelete(subCategoryId);

    if (!subCategory) throw new ApiError(500, "Some thing went wrong");

    return res.status(200).json(new ApiResponse(200, {}, "Sub category deleted successfully"));
    
})

export { createSubCategory, getSubCategoryById, updateSubCategory, updateSubCategoryImage, updateSubCategoryStatus, getSubcategories, deleteSubcategory }