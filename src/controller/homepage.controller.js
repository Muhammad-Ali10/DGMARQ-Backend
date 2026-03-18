import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { logger } from "../utils/logger.js";

/**
 * Returns all homepage data in a single request.
 * Replaces 9+ parallel frontend API calls with 1.
 */
const getHomepageData = asyncHandler(async (req, res) => {
  const [
    { BestSeller },
    { TrendingOffer },
    { UpcomingRelease },
    { UpcomingGames },
    { TrendingCategory },
    { Product },
    { SeoSettings },
    { HomepageSlider },
  ] = await Promise.all([
    import("../models/bestseller.model.js"),
    import("../models/trendingoffer.model.js"),
    import("../models/upcomingrelease.model.js"),
    import("../models/upcominggames.model.js"),
    import("../models/trendingcategory.model.js"),
    import("../models/product.model.js"),
    import("../models/seo.model.js"),
    import("../models/homepageslider.model.js"),
  ]);

  const [
    bestsellers,
    trendingOffers,
    upcomingReleases,
    upcomingGames,
    trendingCategories,
    featuredProducts,
    seoSettings,
    sliders,
  ] = await Promise.all([
    BestSeller.find()
      .sort({ salesCount: -1 })
      .limit(12)
      .populate("productId", "name slug price discount images platform region type stock isFeatured")
      .lean()
      .catch((e) => { logger.error("Homepage: bestsellers fetch failed", e); return []; }),

    TrendingOffer.find({ isActive: true })
      .populate("products", "name slug price discount images platform region type stock")
      .lean()
      .catch((e) => { logger.error("Homepage: trending offers fetch failed", e); return []; }),

    UpcomingRelease.find()
      .populate("product", "name slug price discount images platform region type")
      .lean()
      .catch((e) => { logger.error("Homepage: upcoming releases fetch failed", e); return []; }),

    UpcomingGames.find()
      .lean()
      .catch((e) => { logger.error("Homepage: upcoming games fetch failed", e); return []; }),

    TrendingCategory.find()
      .populate("category", "name slug image description")
      .lean()
      .catch((e) => { logger.error("Homepage: trending categories fetch failed", e); return []; }),

    Product.find({ status: "active", isFeatured: true })
      .sort({ rating: -1 })
      .limit(6)
      .lean()
      .catch((e) => { logger.error("Homepage: featured products fetch failed", e); return { docs: [] }; }),

    SeoSettings.findOne({ page: "home" })
      .lean()
      .catch(() => null),

    HomepageSlider.find({ isActive: true })
      .lean()
      .catch(() => []),
  ]);

  return res.status(200).json(
    new ApiResponse(200, {
      bestsellers,
      trendingOffers,
      upcomingReleases,
      upcomingGames,
      trendingCategories,
      featuredProducts,
      seoSettings,
      sliders,
    }, "Homepage data retrieved successfully")
  );
});

export { getHomepageData };
