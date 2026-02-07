import { generateBestSellers } from "../services/bestseller.service.js";

// Purpose: Monthly job to regenerate best sellers list
export const runBestSellerGeneration = async () => {
  try {
    return await generateBestSellers();
  } catch (error) {
    throw error;
  }
};
