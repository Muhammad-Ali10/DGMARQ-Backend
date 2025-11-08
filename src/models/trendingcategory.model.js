import mongoose from "mongoose";


const trendingCategorySchema = new Schema(
  {
    categoryId: { type: Schema.Types.ObjectId, ref: "Category", required: true },
    rankingScore: { type: Number, default: 0 },
  },
  { timestamps: true },
)

export const TrendingCategory = mongoose.model("TrendingCategory", trendingCategorySchema)
