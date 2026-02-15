import mongoose, { Schema } from "mongoose";

const analyticsSchema = new Schema(
    {
        productId: { type: Schema.Types.ObjectId, ref: "Product", index: true },
        categoryId: { type: Schema.Types.ObjectId, ref: "Category", index: true },
        salesCount: { type: Number, default: 0 },
        categorySalesCount: { type: Number, default: 0 },
        viewsCount: { type: Number, default: 0 },
        wishlistCount: { type: Number, default: 0 },
        lastUpdated: Date,
    },
    { timestamps: true },
)

export const Analytics = mongoose.model("Analytics", analyticsSchema)
