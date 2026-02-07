import mongoose from "mongoose";
const { Schema } = mongoose;
import mongooseAggregatePaginate from "mongoose-aggregate-paginate-v2";
const subCategorySchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, index: true, trim: true, lowercase: true },
    parentCategory: { type: Schema.Types.ObjectId, ref: "Category", required: true },
    image: String,
    description: String,
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

subCategorySchema.index({ parentCategory: 1, slug: 1 }, { unique: true });

subCategorySchema.plugin(mongooseAggregatePaginate);
// Purpose: Represents a subcategory nested under a parent category
export const SubCategory = mongoose.model("SubCategory", subCategorySchema);
