import { generateBestSellers } from "../services/bestseller.service.js";

export const runBestSellerGeneration = async () => {
  try {
    return await generateBestSellers();
  } catch (error) {
    throw error;
  }
};
