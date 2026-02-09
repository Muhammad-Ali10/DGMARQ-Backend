import mongoose from "mongoose";
import { ApiError } from "../utils/ApiError.js";
import { fileUploader } from "../utils/cloudinary.js";
import { fileDeleteFromCloud } from "../utils/deleteFilesFromCloud.js";
import { Product } from "../models/product.model.js";
import { Category } from "../models/category.model.js";
import { Type } from "../models/type.model.js";



// Purpose: Validates MongoDB ObjectIds for a list of items and cleans up files on error
export const validateMongoIds = (items, files) => {
  for (const { id, name, optional } of items) {
    if ((!optional && !id) || (id && !mongoose.Types.ObjectId.isValid(id))) {
      fileDeleteFromCloud(files);
      throw new ApiError(400, `Invalid ${name} ID`);
    }
  }
};

// Purpose: Verifies that referenced models exist and cleans up files on error
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

// Purpose: Validates MongoDB ObjectIds for update operations
export const updateValidateMongoIds = (items) => {
  for (const { id, name, optional } of items) {
    if ((!optional && !id) || (id && !mongoose.Types.ObjectId.isValid(id))) {
      throw new ApiError(400, `Invalid ${name} ID`);
    }
  }
};

// Purpose: Verifies that referenced models exist for update operations
export const updateCheckModelRefs = async (items) => {
  for (const { model, id, name, optional } of items) {
    if (!id && optional) continue;

    const exists = await model.exists({ _id: id });
    if (!exists) {
      throw new ApiError(404, `${name} not found`);
    }
  }
};

// Purpose: Checks for duplicate records excluding a specific document ID
export const updateCheckDuplicateRecord = async (
  model,
  filters,
  exclude = null
) => {
  const query = exclude ? { _id: { $ne: exclude }, ...filters } : filters;

  const exists = await model.findOne(query);
  if (exists) {
    throw new ApiError(409, "Duplicate record exists");
  }
};

// Purpose: Checks for duplicate records and cleans up files on error
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

// Purpose: Uploads multiple images to cloud storage and returns URLs and public IDs
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

// Purpose: Prepares MongoDB query filters from request query parameters
export const prepareQueryFilters = async (query, user = null) => {
  const match = {};

  if ((query.categoryName || query.categorySlug) && !query.categoryId) {
    const categoryQuery = { isActive: true };
    if (query.categoryName) {
      categoryQuery.name = { $regex: query.categoryName.trim(), $options: "i" };
    }
    if (query.categorySlug) {
      categoryQuery.slug = query.categorySlug.toLowerCase().trim();
    }
    
    const category = await Category.findOne(categoryQuery);
    if (category) {
      match.categoryId = category._id;
    } else {
      match.categoryId = new mongoose.Types.ObjectId("000000000000000000000000");
    }
  }

  if (query.typeName && !query.type) {
    const type = await Type.findOne({
      name: { $regex: query.typeName.trim(), $options: "i" },
      isActive: true
    });
    if (type) {
      query.type = type._id.toString();
    } else {
      match.type = new mongoose.Types.ObjectId("000000000000000000000000");
    }
  }

  const objectIdFields = [
    "categoryId",
    "subCategoryId",
    "platform",
    "region",
    "type",
    "genre",
    "mode",
    "device",
    "theme",
  ];

  objectIdFields.forEach((key) => {
    if (query[key]) {
      const ids = Array.isArray(query[key]) 
        ? query[key] 
        : String(query[key]).split(',').filter(Boolean);
      
      const validIds = ids
        .map(id => String(id).trim())
        .filter(id => mongoose.Types.ObjectId.isValid(id))
        .map(id => new mongoose.Types.ObjectId(id));
      
      if (validIds.length > 0) {
        match[key] = validIds.length === 1 ? validIds[0] : { $in: validIds };
      }
    }
  });

  if (query.sellerId && query.userId && mongoose.Types.ObjectId.isValid(query.sellerId) && mongoose.Types.ObjectId.isValid(query.userId)) {
    match.$or = [
      { sellerId: new mongoose.Types.ObjectId(query.sellerId) },
      { sellerId: new mongoose.Types.ObjectId(query.userId) }
    ];
  } else if (query.sellerId && mongoose.Types.ObjectId.isValid(query.sellerId)) {
    match.sellerId = new mongoose.Types.ObjectId(query.sellerId);
  }

  if (query.status) {
    const normalized = String(query.status).toLowerCase();
    if (['active', 'approved', 'published'].includes(normalized)) {
      match.status = { $in: ['active', 'approved'] };
    } else {
      match.status = query.status;
    }
  }

  if (query.isFeatured === 'true' || query.isFeatured === true) {
    match.isFeatured = true;
  } else if (query.isFeatured === 'false' || query.isFeatured === false) {
    match.isFeatured = false;
  }

  if (query.search) {
    match.name = { $regex: query.search, $options: "i" };
  }

  if (query.minPrice || query.maxPrice) {
    match.price = {};
    if (query.minPrice) {
      match.price.$gte = Number(query.minPrice);
    }
    if (query.maxPrice) {
      match.price.$lte = Number(query.maxPrice);
    }
  } else if (query.price) {
    match.price = { $lte: Number(query.price) };
  }

  if (query.inStock === 'true' || query.inStock === true) {
    match.stock = { $gt: 0 };
  }

  if (!user || !user.roles?.includes('seller') && !user.roles?.includes('admin')) {
    if (!match.status) {
      match.status = { $in: ['active', 'approved'] };
    }
  }


  return match;
};

export const lookupStages = [
  {
    from: "categories",
    localField: "categoryId",
    foreignField: "_id",
    as: "category",
  },
  {
    from: "subcategories",
    localField: "subCategoryId",
    foreignField: "_id",
    as: "subCategory",
  },
  {
    from: "platforms",
    localField: "platform",
    foreignField: "_id",
    as: "platform",
  },
  { from: "regions", localField: "region", foreignField: "_id", as: "region" },
  { from: "types", localField: "type", foreignField: "_id", as: "type" },
  { from: "genres", localField: "genre", foreignField: "_id", as: "genre" },
  { from: "modes", localField: "mode", foreignField: "_id", as: "mode" },
  { from: "devices", localField: "device", foreignField: "_id", as: "device" },
  {
    from: "sellers",
    localField: "sellerId",
    foreignField: "_id",
    as: "seller",
  },
  { from: "themes", localField: "theme", foreignField: "_id", as: "theme" },
  {
    from: "reviews",
    localField: "_id",
    foreignField: "productId",
    as: "reviews",
  },
].map((l) => ({
  $lookup: {
    from: l.from,
    localField: l.localField,
    foreignField: l.foreignField,
    as: l.as,
  },
}));

// Purpose: Fetches products using aggregation pipeline with filtering and pagination
export const fetchProducts = async (query, user = null) => {
  const match = await prepareQueryFilters(query, user);

  let sortStage = { createdAt: -1 };
  if (query.sort) {
    const sortValue = String(query.sort).toLowerCase();
    switch (sortValue) {
      case 'price_asc':
        sortStage = { price: 1 };
        break;
      case 'price_desc':
        sortStage = { price: -1 };
        break;
      case 'newest':
        sortStage = { createdAt: -1 };
        break;
      case 'oldest':
        sortStage = { createdAt: 1 };
        break;
      case 'rating':
        sortStage = { averageRating: -1, reviewCount: -1 };
        break;
      case 'name_asc':
        sortStage = { name: 1 };
        break;
      case 'name_desc':
        sortStage = { name: -1 };
        break;
      default:
        sortStage = { createdAt: -1 };
    }
  }

  const pipeline = [
    { $match: match },
    { $sort: sortStage },
    ...lookupStages,
    {
      $unwind: {
        path: "$category",
        preserveNullAndEmptyArrays: true
      }
    },
    {
      $unwind: {
        path: "$subCategory",
        preserveNullAndEmptyArrays: true
      }
    },
    {
      $unwind: {
        path: "$platform",
        preserveNullAndEmptyArrays: true
      }
    },
    {
      $unwind: {
        path: "$region",
        preserveNullAndEmptyArrays: true
      }
    },
    {
      $unwind: {
        path: "$type",
        preserveNullAndEmptyArrays: true
      }
    },
    {
      $unwind: {
        path: "$genre",
        preserveNullAndEmptyArrays: true
      }
    },
    {
      $unwind: {
        path: "$mode",
        preserveNullAndEmptyArrays: true
      }
    },
    {
      $unwind: {
        path: "$device",
        preserveNullAndEmptyArrays: true
      }
    },
    {
      $unwind: {
        path: "$theme",
        preserveNullAndEmptyArrays: true
      }
    },
    {
      $unwind: {
        path: "$seller",
        preserveNullAndEmptyArrays: true
      }
    },
    {
      $project: {
        _id: 1,
        name: 1,
        slug: 1,
        description: 1,
        price: 1,
        originalPrice: "$price",
        stock: 1,
        images: 1,
        discount: 1,
        status: 1,
        sellerId: 1,
        featuredExtraCommission: 1,
        category: {
          _id: "$category._id",
          name: "$category.name",
          slug: "$category.slug"
        },
        subCategory: {
          _id: "$subCategory._id",
          name: "$subCategory.name",
          slug: "$subCategory.slug"
        },
        seller: {
          _id: "$seller._id",
          shopName: "$seller.shopName",
          shopLogo: "$seller.shopLogo"
        },
        platform: {
          _id: "$platform._id",
          name: "$platform.name"
        },
        region: {
          _id: "$region._id",
          name: "$region.name"
        },
        type: {
          _id: "$type._id",
          name: "$type.name"
        },
        genre: {
          _id: "$genre._id",
          name: "$genre.name"
        },
        mode: {
          _id: "$mode._id",
          name: "$mode.name"
        },
        device: {
          _id: "$device._id",
          name: "$device.name"
        },
        theme: {
          _id: "$theme._id",
          name: "$theme.name"
        },
        reviews: 1,
        isFeatured: 1,
        averageRating: 1,
        reviewCount: 1,
        metaTitle: 1,
        metaDescription: 1,
        availableKeysCount: 1,
        totalKeysCount: 1,
        productType: 1,
        createdAt: 1,
        updatedAt: 1,
      },
    },
  ];


  const result = await Product.aggregatePaginate(Product.aggregate(pipeline), {
    page: Number(query.page) || 1,
    limit: Number(query.limit) || 10,
  });

  if (result.docs && result.docs.length > 0) {
    const { getTrendingOfferForProduct, calculateTrendingOfferDiscount } = await import('./trendingoffer.service.js');
    
    const enrichedDocs = await Promise.all(
      result.docs.map(async (product) => {
        const offer = await getTrendingOfferForProduct(product._id);
        if (offer) {
          const pricing = await calculateTrendingOfferDiscount(product._id, product.price);
          return {
            ...product,
            trendingOffer: {
              discountPercent: offer.discountPercent,
              offerId: offer._id,
            },
            discountedPrice: pricing.discountedPrice,
            hasTrendingOffer: true,
          };
        }
        return product;
      })
    );
    
    result.docs = enrichedDocs;
  }


  return result;
};
