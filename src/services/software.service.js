import mongoose from "mongoose";
import { Product } from "../models/product.model.js";
import { Category } from "../models/category.model.js";
import { SubCategory } from "../models/subcategory.model.js";
import { Platform } from "../models/platform.model.js";
import cache from "../utils/cache.js";
import { getTrendingOfferForProduct, calculateTrendingOfferDiscount } from "./trendingoffer.service.js";

const fetchSoftwareSection = async (filters, sortBy = { createdAt: -1 }, limit = 6) => {
  const match = {
    status: { $in: ['active', 'approved'] },
    ...filters,
  };

  // Use lean() for faster queries and select only needed fields
  const products = await Product.find(match)
    .select('_id name slug price discount images status averageRating reviewCount platform region categoryId subCategoryId createdAt')
    .populate('platform', 'name')
    .populate('region', 'name')
    .populate('categoryId', 'name slug')
    .populate('subCategoryId', 'name slug')
    .sort(sortBy)
    .limit(limit)
    .lean();

  const enrichedProducts = await Promise.all(
    products.map(async (product) => {
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

  return enrichedProducts;
};

const getCategoryIdsByName = async (namePatterns) => {
  const cacheKey = `category_ids_${JSON.stringify(namePatterns)}`;
  let categoryIds = cache.get(cacheKey);
  
  if (!categoryIds) {
    const categories = await Category.find({
      $or: namePatterns.map(pattern => ({
        name: { $regex: new RegExp(pattern, 'i') }
      }))
    }).select('_id').lean();
    
    categoryIds = categories.map(c => c._id);
    cache.set(cacheKey, categoryIds, 3600000);
  }
  
  return categoryIds;
};

const getSubCategoryIdsByName = async (namePatterns) => {
  const cacheKey = `subcategory_ids_${JSON.stringify(namePatterns)}`;
  let subCategoryIds = cache.get(cacheKey);
  
  if (!subCategoryIds) {
    const subCategories = await SubCategory.find({
      $or: namePatterns.map(pattern => ({
        name: { $regex: new RegExp(pattern, 'i') }
      }))
    }).select('_id').lean();
    
    subCategoryIds = subCategories.map(c => c._id);
    cache.set(cacheKey, subCategoryIds, 3600000);
  }
  
  return subCategoryIds;
};

const getPlatformIdByName = async (platformName) => {
  const cacheKey = `platform_${platformName.toLowerCase()}`;
  let platformId = cache.get(cacheKey);
  
  if (!platformId) {
    const platform = await Platform.findOne({ 
      name: { $regex: new RegExp(`^${platformName}$`, 'i') },
      isActive: true
    }).select('_id').lean();
    
    if (platform) {
      platformId = platform._id.toString();
      cache.set(cacheKey, platformId, 3600000);
    }
  }
  
  return platformId ? new mongoose.Types.ObjectId(platformId) : null;
};

const getPlatformIdsByName = async (namePatterns) => {
  const cacheKey = `platform_ids_${JSON.stringify(namePatterns)}`;
  let platformIds = cache.get(cacheKey);
  
  if (!platformIds) {
    const platforms = await Platform.find({
      $or: namePatterns.map(pattern => ({
        name: { $regex: new RegExp(pattern, 'i') }
      })),
      isActive: true
    }).select('_id').lean();
    
    platformIds = platforms.map(p => p._id);
    cache.set(cacheKey, platformIds, 3600000);
  }
  
  return platformIds;
};

export const getSoftwarePageData = async () => {
  const cacheKey = 'software_page_data';
  
  const cached = cache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const [microsoftPlatformId, vpnCategoryIds, vpnSubCategoryIds, iosPlatformIds, graphicCategoryIds, graphicSubCategoryIds, antivirusCategoryIds, antivirusSubCategoryIds] = await Promise.all([
    getPlatformIdByName('Microsoft'),
    getCategoryIdsByName(['vpn']),
    getSubCategoryIdsByName(['vpn']),
    getPlatformIdsByName(['ios', 'iphone', 'ipad', 'apple']),
    getCategoryIdsByName(['graphic', 'design', 'adobe', 'photoshop', 'illustrator']),
    getSubCategoryIdsByName(['graphic', 'design']),
    getCategoryIdsByName(['antivirus', 'security', 'protection']),
    getSubCategoryIdsByName(['antivirus', 'security']),
  ]);

  const vpnFilters = {
    $or: [
      ...(vpnCategoryIds.length > 0 ? [{ categoryId: { $in: vpnCategoryIds } }] : []),
      ...(vpnSubCategoryIds.length > 0 ? [{ subCategoryId: { $in: vpnSubCategoryIds } }] : [])
    ]
  };
  if (vpnFilters.$or.length === 0) delete vpnFilters.$or;

  const iosFilters = iosPlatformIds.length > 0 ? { platform: { $in: iosPlatformIds } } : { _id: { $exists: false } }; // Return empty if no platforms found

  const graphicFilters = {
    $or: [
      ...(graphicCategoryIds.length > 0 ? [{ categoryId: { $in: graphicCategoryIds } }] : []),
      ...(graphicSubCategoryIds.length > 0 ? [{ subCategoryId: { $in: graphicSubCategoryIds } }] : [])
    ]
  };
  if (graphicFilters.$or.length === 0) delete graphicFilters.$or;

  const antivirusFilters = {
    $or: [
      ...(antivirusCategoryIds.length > 0 ? [{ categoryId: { $in: antivirusCategoryIds } }] : []),
      ...(antivirusSubCategoryIds.length > 0 ? [{ subCategoryId: { $in: antivirusSubCategoryIds } }] : [])
    ]
  };
  if (antivirusFilters.$or.length === 0) delete antivirusFilters.$or;
  
  const queries = {
    trendingOffers: fetchSoftwareSection(
      {},
      { createdAt: -1 },
      6
    ),
    
    microsoft: microsoftPlatformId 
      ? fetchSoftwareSection(
          { platform: microsoftPlatformId },
          { createdAt: -1 },
          6
        )
      : Promise.resolve([]),
    
    bestSellers: fetchSoftwareSection(
      {},
      { reviewCount: -1, averageRating: -1 },
      6
    ),
    
    vpns: Object.keys(vpnFilters).length > 0
      ? fetchSoftwareSection(vpnFilters, { createdAt: -1 }, 6)
      : Promise.resolve([]),
    
    iosUtilities: Object.keys(iosFilters).length > 0 && !iosFilters._id?.$exists
      ? fetchSoftwareSection(iosFilters, { createdAt: -1 }, 6)
      : Promise.resolve([]),
    
    graphicDesign: Object.keys(graphicFilters).length > 0
      ? fetchSoftwareSection(graphicFilters, { createdAt: -1 }, 6)
      : Promise.resolve([]),
    
    antivirus: Object.keys(antivirusFilters).length > 0
      ? fetchSoftwareSection(antivirusFilters, { createdAt: -1 }, 6)
      : Promise.resolve([]),
  };

  const results = await Promise.allSettled(Object.values(queries));
  
  const data = {
    trendingOffers: results[0].status === 'fulfilled' ? results[0].value : [],
    microsoft: results[1].status === 'fulfilled' ? results[1].value : [],
    bestSellers: results[2].status === 'fulfilled' ? results[2].value : [],
    vpns: results[3].status === 'fulfilled' ? results[3].value : [],
    iosUtilities: results[4].status === 'fulfilled' ? results[4].value : [],
    graphicDesign: results[5].status === 'fulfilled' ? results[5].value : [],
    antivirus: results[6].status === 'fulfilled' ? results[6].value : [],
  };

  cache.set(cacheKey, data, 120000);

  return data;
};
