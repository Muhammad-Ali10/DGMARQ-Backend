import mongoose from "mongoose";
import { Category } from "../models/category.model.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { fileUploader } from "../utils/cloudinary.js";




const createCategory = asyncHandler(async (req, res) => {

    const { name, slug, description } = req.body;

    if (!name || !slug) {
        throw new ApiError(400, "All fields are required");
    }

    const existingCategory = await Category.findOne({ $or: [{ slug }, { name }] })

    if (existingCategory) {
        throw new ApiError(409, "Category with this name or slug already exists");
    }

    const localimagePath = req.file.path;

    if (!localimagePath) {
        throw new ApiError(400, "All fields are required");
    }

    const categoryImage = await fileUploader(localimagePath);

    if (!categoryImage) {
        throw new ApiError(500, "Some thing went wrong");
    }

    const category = await Category.create({
        name,
        slug,
        description,
        image: categoryImage.url
    });

    return res.status(201).json(new ApiResponse(201, category, "Category created successfully"));

})

const getCategoryById = asyncHandler(async (req, res) => {

    const { categoryId } = req.params

    if (!mongoose.Types.ObjectId.isValid(categoryId)) {
        throw new ApiError(400, "Invalid Category Id")
    }

    const category = await Category.findById(categoryId)

    if (!category) {
        throw new ApiError(404, "Category not found")
    }

    return res.status(200).json(new ApiResponse(200, category, "Category fetched successfully"))
})

const updateCategory = asyncHandler(async (req, res) => {

    const { categoryId } = req.params;
    const { name, slug, description } = req.body;

    if (!mongoose.Types.ObjectId.isValid(categoryId)) {
        throw new ApiError(400, "Invalid Category Id");
    }

    const isCategoryExists = await Category.findOne({
        $or: [{ name }, { slug }],
        _id: { $ne: new mongoose.Types.ObjectId(categoryId) },
    });

    if (isCategoryExists) {
        throw new ApiError(409, "Category with this name or slug already exists")
    }

    const category = await Category.findByIdAndUpdate(categoryId,
        { name, slug, description },
        { new: true });

    if (!category) throw new ApiError(404, "Category not found");

    return res.status(200).json(new ApiResponse(200, category, "Category updated successfully"));

})

const updateCategoryImage = asyncHandler(async (req, res) => {

    const { categoryId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(categoryId)) {
        throw new ApiError(400, "Invalid Category Id")
    }

    const localimagePath = req.file.path;

    if (!localimagePath) {
        throw new ApiError(400, "All fields are required")
    }
    const categoryImage = await fileUploader(localimagePath);

    if (!categoryImage) {
        throw new ApiError(500, "Some thing went wrong");
    }

    const category = await Category.findByIdAndUpdate(categoryId,
        { image: categoryImage.url },
        { new: true });

    return res.status(200).json(new ApiResponse(200, category, "Category image updated successfully"));

})


const updateCategoryStatus = asyncHandler(async (req, res) => {
    const { categoryId } = req.params;
    const { status } = req.body;

    if (!mongoose.Types.ObjectId.isValid(categoryId)) {
        throw new ApiError(400, "Invalid Category ID");
    }

    if (typeof status !== "boolean") {
        throw new ApiError(400, "Status must be a boolean (true or false)");
    }

    const category = await Category.findByIdAndUpdate(
        categoryId,
        { isActive: status },
        { new: true }
    );

    if (!category) throw new ApiError(404, "Category not found");

    const message = status
        ? "Category activated successfully"
        : "Category deactivated successfully";

    return res
        .status(200)
        .json(new ApiResponse(200, category, message));
});



const getCategories = asyncHandler(async (req, res) => {

    const { page = 1, limit = 10, search = "", isActive } = req.query;

    const match = {};

    if (search.trim()) {
        match.name = { $regex: search, $options: "i" };
    }

    if (isActive !== undefined) {
        match.isActive = isActive === "true";
    }

    const categoryAggregate = Category.aggregate([
        { $match: match },
        { $sort: { createdAt: -1 } },
        {
            $lookup: {
                from: "subcategories",
                localField: "_id",
                foreignField: "parentCategory",
                as: "subcategories",
            }
        },
        {
            $project: {
                name: 1,
                slug: 1,
                image: 1,
                isActive: 1,
                "subcategories.name": 1,
                "subcategories.slug": 1,
                "subcategories.image": 1,
                "subcategories.isActive": 1,
                createdAt: 1,
            },
        },
    ]);

    const categories = await Category.aggregatePaginate(
        categoryAggregate,
        {
            page: parseInt(page),
            limit: parseInt(limit),
        }
    );

    return res
        .status(200)
        .json(new ApiResponse(200, categories, "Categories fetched successfully"));
});



const deleteCategory = asyncHandler(async (req, res) => {

    const { categoryId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(categoryId)) {
        throw new ApiError(400, "Invalid Category Id")
    }
    const category = await Category.findByIdAndDelete(categoryId);

    if (!category) throw new ApiError(500, "Some thing went wrong");

    return res.status(200).json(new ApiResponse(200, {}, "Category deleted successfully"));
})


export { createCategory, getCategoryById, updateCategory, updateCategoryImage, updateCategoryStatus, getCategories, deleteCategory }