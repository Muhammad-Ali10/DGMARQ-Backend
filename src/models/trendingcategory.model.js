import mongoose, { Schema } from "mongoose";

const trendingCategorySchema = new Schema(
  {
    categoryId: { type: Schema.Types.ObjectId, ref: "Category", required: true, unique: true, index: true },
    totalSales: { type: Number, default: 0, index: true },
    totalRevenue: { type: Number, default: 0, index: true },
    generatedAt: { type: Date, required: true, index: true },
    month: { type: Number, required: true, index: true },
    year: { type: Number, required: true, index: true },
  },
  { timestamps: true },
)

trendingCategorySchema.index({ year: 1, month: 1, totalSales: -1 });
trendingCategorySchema.index({ generatedAt: -1 });

export const TrendingCategory = mongoose.model("TrendingCategory", trendingCategorySchema)
