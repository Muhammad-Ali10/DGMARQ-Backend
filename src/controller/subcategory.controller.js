import mongoose from "mongoose";
import { SubCategory } from "../models/subcategory.model.js";
import { Category } from "../models/category.model.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { fileUploader } from "../utils/cloudinary.js";


// Creates a new subcategory with validation, parent category verification, and image upload
const createSubCategory = asyncHandler(async (req, res) => {

    const { name, slug, parentCategory, description } = req.body;

    if (!name || !slug || !parentCategory) {
        throw new ApiError(400, "Name, slug, and parent category are required");
    }

    const slugRegex = /^[a-z0-9-_]+$/;
    if (!slugRegex.test(slug)) {
        throw new ApiError(400, "Slug must contain only lowercase letters, numbers, hyphens, and underscores");
    }

    if (name.trim().length < 2 || name.trim().length > 100) {
        throw new ApiError(400, "Name must be between 2 and 100 characters");
    }

    if (!mongoose.Types.ObjectId.isValid(parentCategory)) {
        throw new ApiError(400, "Invalid parent category ID");
    }

    const isParentCategoryExists = await Category.findById(parentCategory);
    if (!isParentCategoryExists) {
        throw new ApiError(404, "Parent category not found");
    }

    const existingSubCategory = await SubCategory.findOne({ 
        parentCategory,
        $or: [{ slug: slug.toLowerCase().trim() }, { name: name.trim() }]
    });

    if (existingSubCategory) {
        throw new ApiError(409, "Subcategory with this name or slug already exists in this category");
    }

    if (!req.file) {
        throw new ApiError(400, "Subcategory image is required");
    }

    const localimagePath = req.file.path;

    if (!localimagePath) {
        throw new ApiError(400, "Failed to upload image");
    }

    const subCategoryImage = await fileUploader(localimagePath);

    if (!subCategoryImage || !subCategoryImage.url) {
        throw new ApiError(500, "Failed to upload image to cloud storage");
    }

    const subCategory = await SubCategory.create({
        name: name.trim(),
        slug: slug.toLowerCase().trim(),
        parentCategory,
        image: subCategoryImage.url,
        description: description ? description.trim() : ""
    });

    return res.status(201).json(new ApiResponse(201, subCategory, "Subcategory created successfully"));

})


// Retrieves a single subcategory by ID with populated parent category
const getSubCategoryById = asyncHandler(async (req, res) => {

    const { subCategoryId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(subCategoryId)) {
        throw new ApiError(400, "Invalid Subcategory ID");
    }

    const subCategory = await SubCategory.findById(subCategoryId)
        .populate('parentCategory', 'name slug image');

    if (!subCategory) {
        throw new ApiError(404, "Subcategory not found");
    }

    return res.status(200).json(new ApiResponse(200, subCategory, "Subcategory fetched successfully"));
})

// Retrieves a subcategory by category and subcategory slugs for frontend routing
const getSubCategoryBySlug = asyncHandler(async (req, res) => {
    const { categorySlug, subcategorySlug } = req.params;

    if (!categorySlug || !subcategorySlug) {
        throw new ApiError(400, "Category slug and subcategory slug are required");
    }

    const category = await Category.findOne({ slug: categorySlug.toLowerCase().trim() });
    if (!category) {
        throw new ApiError(404, "Category not found");
    }

    const subCategory = await SubCategory.findOne({
        slug: subcategorySlug.toLowerCase().trim(),
        parentCategory: category._id
    }).populate('parentCategory', 'name slug image');

    if (!subCategory) {
        throw new ApiError(404, "Subcategory not found");
    }

    return res.status(200).json(new ApiResponse(200, subCategory, "Subcategory fetched successfully"));
})


// Updates subcategory details with validation and duplicate checking
const updateSubCategory = asyncHandler(async (req, res) => {

    const { subCategoryId } = req.params;
    const { name, slug, parentCategory, description } = req.body;

    if (!mongoose.Types.ObjectId.isValid(subCategoryId)) {
        throw new ApiError(400, "Invalid Subcategory ID");
    }

    const existingSubCategory = await SubCategory.findById(subCategoryId);
    if (!existingSubCategory) {
        throw new ApiError(404, "Subcategory not found");
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

    if (parentCategory !== undefined) {
        if (!mongoose.Types.ObjectId.isValid(parentCategory)) {
            throw new ApiError(400, "Invalid parent category ID");
        }
        const isParentCategoryExists = await Category.findById(parentCategory);
        if (!isParentCategoryExists) {
            throw new ApiError(404, "Parent category not found");
        }
    }

    const finalParentCategory = parentCategory || existingSubCategory.parentCategory;
    if (name || slug) {
        const isSubCategoryExists = await SubCategory.findOne({
            parentCategory: finalParentCategory,
            $or: [
                ...(name ? [{ name: name.trim() }] : []),
                ...(slug ? [{ slug: slug.toLowerCase().trim() }] : [])
            ],
            _id: { $ne: new mongoose.Types.ObjectId(subCategoryId) },
        });

        if (isSubCategoryExists) {
            throw new ApiError(409, "Subcategory with this name or slug already exists in this category");
        }
    }

    const updateData = {};
    if (name !== undefined) updateData.name = name.trim();
    if (slug !== undefined) updateData.slug = slug.toLowerCase().trim();
    if (parentCategory !== undefined) updateData.parentCategory = parentCategory;
    if (description !== undefined) updateData.description = description.trim();

    const subCategory = await SubCategory.findByIdAndUpdate(
        subCategoryId,
        updateData,
        { new: true, runValidators: true }
    );

    if (!subCategory) throw new ApiError(404, "Subcategory not found");

    return res.status(200).json(new ApiResponse(200, subCategory, "Subcategory updated successfully"));

})

// Updates subcategory image with cloud storage upload
const updateSubCategoryImage = asyncHandler(async (req, res) => {

    const { subCategoryId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(subCategoryId)) {
        throw new ApiError(400, "Invalid Subcategory ID");
    }

    const existingSubCategory = await SubCategory.findById(subCategoryId);
    if (!existingSubCategory) {
        throw new ApiError(404, "Subcategory not found");
    }

    if (!req.file) {
        throw new ApiError(400, "Image file is required");
    }

    const localimagePath = req.file.path;

    if (!localimagePath) {
        throw new ApiError(400, "Failed to upload image");
    }

    const subCategoryImage = await fileUploader(localimagePath);

    if (!subCategoryImage || !subCategoryImage.url) {
        throw new ApiError(500, "Failed to upload image to cloud storage");
    }

    const subCategory = await SubCategory.findByIdAndUpdate(
        subCategoryId,
        { image: subCategoryImage.url },
        { new: true, runValidators: true }
    );

    if (!subCategory) {
        throw new ApiError(404, "Subcategory not found");
    }

    return res.status(200).json(new ApiResponse(200, subCategory, "Subcategory image updated successfully"));

})

// Updates subcategory active status
const updateSubCategoryStatus = asyncHandler(async (req, res) => {

    const { subCategoryId } = req.params;
    const { status } = req.body;

    if (!mongoose.Types.ObjectId.isValid(subCategoryId)) {
        throw new ApiError(400, "Invalid Subcategory ID");
    }

    if (typeof status !== "boolean") {
        throw new ApiError(400, "Status must be a boolean (true or false)");
    }

    const subCategory = await SubCategory.findByIdAndUpdate(
        subCategoryId,
        { isActive: status },
        { new: true, runValidators: true }
    );

    if (!subCategory) throw new ApiError(404, "Subcategory not found");

    const message = status
        ? "Subcategory activated successfully"
        : "Subcategory deactivated successfully";

    return res
        .status(200)
        .json(new ApiResponse(200, subCategory, message));


})

// Retrieves subcategories with pagination, search, filtering, and parent category population
const getSubcategories = asyncHandler(async (req, res) => {

    const { page = 1, limit = 10, search = "", isActive, categoryId } = req.query;

    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 10));

    const match = {};

    if (categoryId) {
        if (!mongoose.Types.ObjectId.isValid(categoryId)) {
            throw new ApiError(400, "Invalid category ID");
        }
        match.parentCategory = new mongoose.Types.ObjectId(categoryId);
    }

    if (search && search.trim()) {
        match.$or = [
            { name: { $regex: search.trim(), $options: "i" } },
            { slug: { $regex: search.trim(), $options: "i" } }
        ];
    }

    if (isActive !== undefined) {
        match.isActive = isActive === "true" || isActive === true;
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
                _id: 1,
                name: 1,
                slug: 1,
                image: 1,
                description: 1,
                isActive: 1,
                "parentCategory._id": 1,
                "parentCategory.name": 1,
                "parentCategory.slug": 1,
                createdAt: 1,
            },
        },
    ]);

    const subCategories = await SubCategory.aggregatePaginate(
        subCategoryAggregate,
        {
            page: pageNum,
            limit: limitNum,
        });

    return res
        .status(200)
        .json(new ApiResponse(200, subCategories, "Subcategories fetched successfully"));



})

// Deletes a subcategory by ID
const deleteSubcategory = asyncHandler(async (req, res) => {

    const { subCategoryId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(subCategoryId)) {
        throw new ApiError(400, "Invalid Subcategory ID");
    }

    const subCategory = await SubCategory.findByIdAndDelete(subCategoryId);

    if (!subCategory) throw new ApiError(404, "Subcategory not found");

    return res.status(200).json(new ApiResponse(200, {}, "Subcategory deleted successfully"));

})

// Retrieves subcategories filtered by parent category ID with pagination
const getSubcategoriesByCategoryId = asyncHandler(async (req, res) => {
    const { categoryId } = req.params;
    const { page = 1, limit = 10, isActive } = req.query;

    if (!mongoose.Types.ObjectId.isValid(categoryId)) {
        throw new ApiError(400, "Invalid Category ID");
    }

    const category = await Category.findById(categoryId);
    if (!category) {
        throw new ApiError(404, "Category not found");
    }

    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 10));

    const match = {
        parentCategory: new mongoose.Types.ObjectId(categoryId)
    };

    if (isActive !== undefined) {
        match.isActive = isActive === "true" || isActive === true;
    }

    const subCategoryAggregate = SubCategory.aggregate([
        { $match: match },
        { $sort: { createdAt: -1 } },
        {
            $project: {
                _id: 1,
                name: 1,
                slug: 1,
                image: 1,
                description: 1,
                isActive: 1,
                createdAt: 1,
            },
        },
    ]);

    const subCategories = await SubCategory.aggregatePaginate(
        subCategoryAggregate,
        {
            page: pageNum,
            limit: limitNum,
        }
    );

    return res
        .status(200)
        .json(new ApiResponse(200, {
            docs: subCategories.docs || [],
            totalDocs: subCategories.totalDocs || 0,
            limit: subCategories.limit || limitNum,
            page: subCategories.page || pageNum,
            totalPages: subCategories.totalPages || 1,
            hasNextPage: subCategories.hasNextPage || false,
            hasPrevPage: subCategories.hasPrevPage || false,
            category: {
                _id: category._id,
                name: category.name,
                slug: category.slug
            }
        }, "Subcategories fetched successfully"));
})

// Retrieves subcategories filtered by parent category slug with pagination
const getSubcategoriesByCategorySlug = asyncHandler(async (req, res) => {
    const { categorySlug } = req.params;
    const { page = 1, limit = 10, isActive } = req.query;

    if (!categorySlug) {
        throw new ApiError(400, "Category slug is required");
    }

    const category = await Category.findOne({ slug: categorySlug.toLowerCase().trim() });
    if (!category) {
        throw new ApiError(404, "Category not found");
    }

    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 10));

    const match = {
        parentCategory: category._id
    };

    if (isActive !== undefined) {
        match.isActive = isActive === "true" || isActive === true;
    }

    const subCategoryAggregate = SubCategory.aggregate([
        { $match: match },
        { $sort: { createdAt: -1 } },
        {
            $project: {
                _id: 1,
                name: 1,
                slug: 1,
                image: 1,
                description: 1,
                isActive: 1,
                createdAt: 1,
            },
        },
    ]);

    const subCategories = await SubCategory.aggregatePaginate(
        subCategoryAggregate,
        {
            page: pageNum,
            limit: limitNum,
        }
    );

    return res
        .status(200)
        .json(new ApiResponse(200, {
            docs: subCategories.docs || [],
            totalDocs: subCategories.totalDocs || 0,
            limit: subCategories.limit || limitNum,
            page: subCategories.page || pageNum,
            totalPages: subCategories.totalPages || 1,
            hasNextPage: subCategories.hasNextPage || false,
            hasPrevPage: subCategories.hasPrevPage || false,
            category: {
                _id: category._id,
                name: category.name,
                slug: category.slug
            }
        }, "Subcategories fetched successfully"));
})

export { 
    createSubCategory, 
    getSubCategoryById, 
    getSubCategoryBySlug,
    updateSubCategory, 
    updateSubCategoryImage, 
    updateSubCategoryStatus, 
    getSubcategories, 
    deleteSubcategory, 
    getSubcategoriesByCategoryId,
    getSubcategoriesByCategorySlug
}