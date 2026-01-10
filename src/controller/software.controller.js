import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { getSoftwarePageData } from "../services/software.service.js";

// Get Software page data (all sections in one optimized request)
const getSoftwarePage = asyncHandler(async (req, res) => {
  const data = await getSoftwarePageData();
  
  return res.status(200).json(
    new ApiResponse(200, data, "Software page data retrieved successfully")
  );
});

export { getSoftwarePage };
