import mongoose, { Schema } from "mongoose";

const trendingCategorySchema = new Schema(
  {
    categoryId: { type: Schema.Types.ObjectId, ref: "Category", required: true, unique: true, index: true },
    totalSales: { type: Number, default: 0, index: true }, // Total quantity sold in current month
    totalRevenue: { type: Number, default: 0, index: true }, // Total revenue in current month
    generatedAt: { type: Date, required: true, index: true }, // When this trending data was calculated
    month: { type: Number, required: true, index: true }, // Month (1-12) for which this data is valid
    year: { type: Number, required: true, index: true }, // Year for which this data is valid
  },
  { timestamps: true },
)

// Compound index for efficient monthly queries
trendingCategorySchema.index({ year: 1, month: 1, totalSales: -1 });
trendingCategorySchema.index({ generatedAt: -1 });

export const TrendingCategory = mongoose.model("TrendingCategory", trendingCategorySchema)
