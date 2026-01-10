import { generateBestSellers } from "../services/bestseller.service.js";

/**
 * Monthly job to regenerate best sellers
 * This should be called by a cron scheduler (e.g., node-cron, cron-job.org, etc.)
 * 
 * Example cron schedule for monthly (1st day of month at 2 AM):
 * 0 2 1 * *
 */
export const runBestSellerGeneration = async () => {
  try {
    console.log("Starting monthly best seller generation...");
    const result = await generateBestSellers();
    
    if (result.success) {
      console.log(
        `Best sellers generated successfully: ${result.count} products at ${result.generatedAt}`
      );
    } else {
      console.log(`Best seller generation completed with message: ${result.message}`);
    }
    
    return result;
  } catch (error) {
    console.error("Error in best seller generation job:", error);
    throw error;
  }
};

// If using node-cron, you can set it up like this:
// import cron from 'node-cron';
// 
// // Run monthly on the 1st day at 2 AM
// cron.schedule('0 2 1 * *', async () => {
//   await runBestSellerGeneration();
// });

