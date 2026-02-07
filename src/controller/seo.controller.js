import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { SeoSettings } from "../models/seoSettings.model.js";

// Purpose: Retrieves home page SEO settings for public access
const getHomePageSEO = asyncHandler(async (req, res) => {
  const seoSettings = await SeoSettings.findOne({ page: 'home' });

  if (!seoSettings) {
    return res.status(200).json(
      new ApiResponse(200, {
        page: 'home',
        metaTitle: null,
        metaDescription: null,
      }, "Home page SEO settings retrieved successfully")
    );
  }

  return res.status(200).json(
    new ApiResponse(200, {
      page: seoSettings.page,
      metaTitle: seoSettings.metaTitle,
      metaDescription: seoSettings.metaDescription,
    }, "Home page SEO settings retrieved successfully")
  );
});

export { getHomePageSEO };
