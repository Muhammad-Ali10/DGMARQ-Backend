import mongoose, { Schema } from "mongoose";


const productSchema = new Schema(
  { 
    sellerId: { type: Schema.Types.ObjectId, ref: "Seller", required: true, index: true },
    categoryId: { type: Schema.Types.ObjectId, ref: "Category", required: true, index: true },
    subCategoryId: { type: Schema.Types.ObjectId, ref: "SubCategory" },
    name: { type: String, required: true, index: true },
    slug: { type: String, required: true, index: true },
    description: String,
    price: { type: Number, required: true },
    discount: { type: Number, default: 0 }, // legacy/fallback
    stock: { type: Number, default: 0, index: true },
    images: [{ type: String }],
    platform: { type: Schema.Types.ObjectId, ref: "Platform"},
    region: { type: Schema.Types.ObjectId, ref: "Region"},
    type: { type: Schema.Types.ObjectId, ref: "Type"},  
    genre:{type: Schema.Types.ObjectId, ref: "Genre"},
    mode: { type: Schema.Types.ObjectId, ref: "Mode" },
    rating: { type: Number, default: 0 },
    isFeatured: { type: Boolean, default: false },
    // seller-visible stock of keys vs. physical stock: for license keys stock derived from LicenseKey available count
  },
  { timestamps: true },
)

// indexes helpful for filters
productSchema.index({ platform: 1, region: 1, type: 1 })
productSchema.index({ name: "text", description: "text" })

export const Product = mongoose.model("Product", productSchema)
