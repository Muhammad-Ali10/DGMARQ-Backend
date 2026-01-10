import mongoose from "mongoose";
import { Category } from "../models/category.model.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { fileUploader } from "../utils/cloudinary.js";




// Creates a new category with image upload and validation
const createCategory = asyncHandler(async (req, res) => {

    const { name, slug, description } = req.body;

    if (!name || !slug) {
        throw new ApiError(400, "Name and slug are required");
    }

    const slugRegex = /^[a-z0-9-_]+$/;
    if (!slugRegex.test(slug)) {
        throw new ApiError(400, "Slug must contain only lowercase letters, numbers, hyphens, and underscores");
    }

    if (name.trim().length < 2 || name.trim().length > 100) {
        throw new ApiError(400, "Name must be between 2 and 100 characters");
    }

    const existingCategory = await Category.findOne({ $or: [{ slug: slug.toLowerCase().trim() }, { name: name.trim() }] })

    if (existingCategory) {
        throw new ApiError(409, "Category with this name or slug already exists");
    }

    if (!req.file) {
        throw new ApiError(400, "Category image is required");
    }

    const localimagePath = req.file.path;

    if (!localimagePath) {
        throw new ApiError(400, "Failed to upload image");
    }

    const categoryImage = await fileUploader(localimagePath);

    if (!categoryImage || !categoryImage.url) {
        throw new ApiError(500, "Failed to upload image to cloud storage");
    }

    const category = await Category.create({
        name: name.trim(),
        slug: slug.toLowerCase().trim(),
        description: description ? description.trim() : "",
        image: categoryImage.url
    });

    return res.status(201).json(new ApiResponse(201, category, "Category created successfully"));

})

// Retrieves a single category by ID
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

// Updates category details with validation and duplicate checking
const updateCategory = asyncHandler(async (req, res) => {

    const { categoryId } = req.params;
    const { name, slug, description } = req.body;

    if (!mongoose.Types.ObjectId.isValid(categoryId)) {
        throw new ApiError(400, "Invalid Category Id");
    }

    if (name !== undefined) {
        if (!name || name.trim().length < 2 || name.trim().length > 100) {
            throw new ApiError(400, "Name must be between 2 and 100 characters");
        }
    }

    if (slug !== undefined) {
        const slugRegex = /^[a-z0-9-_]+$/;
        if (!slug || !slugRegex.test(slug)) {
            throw new ApiError(400, "Slug must contain only lowercase letters, numbers, hyphens, and underscores");
        }
    }

    const existingCategory = await Category.findById(categoryId);
    if (!existingCategory) {
        throw new ApiError(404, "Category not found");
    }

    if (name || slug) {
        const isCategoryExists = await Category.findOne({
            $or: [
                ...(name ? [{ name: name.trim() }] : []),
                ...(slug ? [{ slug: slug.toLowerCase().trim() }] : [])
            ],
            _id: { $ne: new mongoose.Types.ObjectId(categoryId) },
        });

        if (isCategoryExists) {
            throw new ApiError(409, "Category with this name or slug already exists");
        }
    }

    const updateData = {};
    if (name !== undefined) updateData.name = name.trim();
    if (slug !== undefined) updateData.slug = slug.toLowerCase().trim();
    if (description !== undefined) updateData.description = description.trim();

    const category = await Category.findByIdAndUpdate(
        categoryId,
        updateData,
        { new: true, runValidators: true }
    );

    if (!category) throw new ApiError(404, "Category not found");

    return res.status(200).json(new ApiResponse(200, category, "Category updated successfully"));

})

// Updates category image with cloud storage upload
const updateCategoryImage = asyncHandler(async (req, res) => {

    const { categoryId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(categoryId)) {
        throw new ApiError(400, "Invalid Category Id");
    }

    const existingCategory = await Category.findById(categoryId);
    if (!existingCategory) {
        throw new ApiError(404, "Category not found");
    }

    if (!req.file) {
        throw new ApiError(400, "Image file is required");
    }

    const localimagePath = req.file.path;

    if (!localimagePath) {
        throw new ApiError(400, "Failed to upload image");
    }

    const categoryImage = await fileUploader(localimagePath);

    if (!categoryImage || !categoryImage.url) {
        throw new ApiError(500, "Failed to upload image to cloud storage");
    }

    const category = await Category.findByIdAndUpdate(
        categoryId,
        { image: categoryImage.url },
        { new: true, runValidators: true }
    );

    if (!category) {
        throw new ApiError(404, "Category not found");
    }

    return res.status(200).json(new ApiResponse(200, category, "Category image updated successfully"));

})


// Updates category active status
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



// Retrieves categories with pagination, search, and filtering
const getCategories = asyncHandler(async (req, res) => {

    const { page = 1, limit = 10, search = "", isActive } = req.query;

    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 10));

    const match = {};

    if (search && search.trim()) {
        match.$or = [
            { name: { $regex: search.trim(), $options: "i" } },
            { slug: { $regex: search.trim(), $options: "i" } }
        ];
    }

    if (isActive !== undefined) {
        match.isActive = isActive === "true" || isActive === true;
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
                _id: 1,
                name: 1,
                slug: 1,
                image: 1,
                description: 1,
                isActive: 1,
                "subcategories._id": 1,
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
            page: pageNum,
            limit: limitNum,
        }
    );

    return res
        .status(200)
        .json(new ApiResponse(200, categories, "Categories fetched successfully"));
});



// Deletes a category by ID
const deleteCategory = asyncHandler(async (req, res) => {

    const { categoryId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(categoryId)) {
        throw new ApiError(400, "Invalid Category Id")
    }
    const category = await Category.findByIdAndDelete(categoryId);

    if (!category) throw new ApiError(404, "Category not found");

    return res.status(200).json(new ApiResponse(200, {}, "Category deleted successfully"));
})


export { createCategory, getCategoryById, updateCategory, updateCategoryImage, updateCategoryStatus, getCategories, deleteCategory }