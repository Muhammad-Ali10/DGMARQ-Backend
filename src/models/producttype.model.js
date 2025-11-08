import mongoose from "mongoose";

const productTypeSchema = new Schema(
    {
        name: {
            type: String,
            required: true,
            unique: true,
            trim: true
        },
    },
    { timestamps: true },
)

export const ProductType = mongoose.model("ProductType", productTypeSchema)
