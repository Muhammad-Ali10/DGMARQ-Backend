import mongoose, { Schema } from "mongoose";
import mongooseAggregatePaginate from "mongoose-aggregate-paginate-v2";

const productSchema = new Schema(
  {
    sellerId: {
      type: Schema.Types.ObjectId,
      ref: "Seller",
      required: true,
      index: true,
    },
    categoryId: {
      type: Schema.Types.ObjectId,
      ref: "Category",
      required: true,
      index: true,
    },
    subCategoryId: { type: Schema.Types.ObjectId, ref: "SubCategory" },
    name: { type: String, required: true, index: true },
    slug: { type: String, required: true, index: true },
    description: String,
    price: { type: Number, required: true },
    discount: { type: Number, default: 0 },
    stock: { type: Number, default: 0, index: true },
    images: [{ type: String }],
    publicId: [{ type: String }],
    platform: { type: Schema.Types.ObjectId, ref: "Platform" },
    region: { type: Schema.Types.ObjectId, ref: "Region" },
    type: { type: Schema.Types.ObjectId, ref: "Type" },
    genre: { type: Schema.Types.ObjectId, ref: "Genre" },
    mode: { type: Schema.Types.ObjectId, ref: "Mode" },
    device: [{ type: Schema.Types.ObjectId, ref: "Device" }],
    rating: { type: Number, default: 0 },
    isFeatured: { type: Boolean, default: false },
  },
  { timestamps: true }
);

productSchema.index({ platform: 1, region: 1, type: 1 });
productSchema.index({ name: "text", description: "text" });
productSchema.plugin(mongooseAggregatePaginate);

export const Product = mongoose.model("Product", productSchema);
