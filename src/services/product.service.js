import mongoose from "mongoose";
import { ApiError } from "../utils/ApiError.js";
import { fileUploader } from "../utils/cloudinary.js";
import { fileDeleteFromCloud } from "../utils/deleteFilesFromCloud.js";
import { Product } from "../models/product.model.js";

export const validateMongoIds = (items, files) => {
  for (const { id, name, optional } of items) {
          console.log(id)

    if ((!optional && !id) || (id && !mongoose.Types.ObjectId.isValid(id))) {
      fileDeleteFromCloud(files);
      throw new ApiError(400, `Invalid ${name} ID`);
    }
  }
};

export const checkModelRefs = async (items, files) => {
  for (const { model, id, name, optional } of items) {
    if (!id && optional) continue;

    const exists = await model.exists({ _id: id });
    if (!exists) {
      fileDeleteFromCloud(files);
      throw new ApiError(404, `${name} not found`);
    }
  }
};

export const checkDuplicateRecord = async (
  model,
  filters,
  files,
  exclude = null
) => {
  const query = exclude ? { _id: { $ne: exclude }, ...filters } : filters;

  const exists = await model.findOne(query);
  if (exists) {
    fileDeleteFromCloud(files);
    throw new ApiError(409, "Duplicate record exists");
  }
};

export const uploadImages = async (files) => {
  if (!files || !Object.keys(files).length)
    throw new ApiError(400, "Images are required");

  const paths = Object.values(files)
    .flat()
    .map((f) => f.path);

  const uploaded = await Promise.all(
    paths.map(async (path) => {
      const res = await fileUploader(path);
      return { url: res.url, public_id: res.public_id };
    })
  );

  if (!uploaded.length) throw new ApiError(500, "Image upload failed");

  return uploaded;
};

export const prepareQueryFilters = (query) => {
  const match = {};

  const objectIdFields = [
    "categoryId",
    "subCategoryId",
    "platform",
    "region",
    "type",
    "genre",
    "mode",
    "device",
    "theme"
  ];

  objectIdFields.forEach((key) => {
    if (query[key] && mongoose.Types.ObjectId.isValid(query[key])) {
      match[key] = new mongoose.Types.ObjectId(query[key]);
    }
  });

  if (query.search) {
    match.name =  { $regex: query.search, $options: "i" };
  }

  if (query.price) {
    match.price = { $lte: Number(query.price) };
  }

  return match;
};

export const lookupStages = [
  { from: "categories", localField: "categoryId", as: "category" },
  { from: "subcategories", localField: "subCategoryId", as: "subCategory" },
  { from: "platforms", localField: "platform", as: "platform" },
  { from: "regions", localField: "region", as: "region" },
  { from: "types", localField: "type", as: "type" },
  { from: "genres", localField: "genre", as: "genre" },
  { from: "modes", localField: "mode", as: "mode" },
  { from: "devices", localField: "device", as: "device" },
  { from: "sellers", localField: "userId", as: "seller" },
  { from: "themes", localField: "theme", as: "theme" },
].map((l) => ({
  $lookup: {
    from: l.from,
    localField: l.localField,
    foreignField: "_id",
    as: l.as,
  },
}));


console.log(lookupStages);
export const fetchProducts = async (query) => {
 
  const match = prepareQueryFilters(query);
 console.log(match);

  const pipeline = [
    { $match: match },
    { $sort: { createdAt: -1 } },
    ...lookupStages,
    {
      $project: {
        name: 1,
        slug: 1,
        description: 1,
        price: 1,
        stock: 1,
        images: 1,
        discount: 1,
        isFeatured: 1,
        createdAt: 1,
        "category.name": 1,
        "subCategory.name": 1,
        "shopName": 1,
        "platform.name": 1,
        "region.name": 1,
        "type.name": 1,
        "genre.name": 1,
        "mode.name": 1,
        "device.name": 1,
        "theme.name": 1,
      },
    },
  ];

  return await Product.aggregatePaginate(Product.aggregate(pipeline), {
    page: Number(query.page) || 1,
    limit: Number(query.limit) || 10,
  });
};
