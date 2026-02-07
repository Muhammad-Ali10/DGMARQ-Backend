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
    device: { type: Schema.Types.ObjectId, ref: "Device" },
    theme: { type: Schema.Types.ObjectId, ref: "Theme" },
    reviews: [{ type: Schema.Types.ObjectId, ref: "Review" }],
    averageRating: { type: Number, default: 0 },
    reviewCount: { type: Number, default: 0 },
    viewCount: { type: Number, default: 0, index: true },
    isFeatured: { type: Boolean, default: false },
    status: {
      type: String,
      enum: ['draft', 'pending', 'approved', 'rejected', 'active'],
      default: 'pending',
      index: true
    },
    approvedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    approvedAt: Date,
    rejectionReason: String,
    totalKeysCount: { type: Number, default: 0 },
    availableKeysCount: { type: Number, default: 0 },
    productType: {
      type: String,
      enum: ['LICENSE_KEY', 'ACCOUNT_BASED'],
      default: 'LICENSE_KEY',
      required: true,
      index: true
    },
    metaTitle: {
      type: String,
      default: null,
      maxlength: 60,
      trim: true,
    },
    metaDescription: {
      type: String,
      default: null,
      maxlength: 160,
      trim: true,
    },
  },
  { timestamps: true }
);

productSchema.index({ platform: 1, region: 1, type: 1 });
productSchema.index({ name: "text", description: "text" });
productSchema.index({ metaTitle: "text" });
productSchema.index({ status: 1, platform: 1 });
productSchema.index({ status: 1, categoryId: 1 });
productSchema.index({ status: 1, subCategoryId: 1 });
productSchema.index({ status: 1, reviewCount: -1, averageRating: -1 });
productSchema.index({ status: 1, createdAt: -1 });
productSchema.plugin(mongooseAggregatePaginate);

// Purpose: Stores product listings with pricing, inventory, and metadata for the marketplace
export const Product = mongoose.model("Product", productSchema);
