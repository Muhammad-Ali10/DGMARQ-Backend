import mongoose from "mongoose";
import mongooseAggregatePaginate from "mongoose-aggregate-paginate-v2";
const productTypeSchema = new Schema(
    {
        name: {
            type: String,
            required: true,
            unique: true,
            trim: true
        },
        isActive: {
            type: Boolean,
            default: true
        }
    },
    { timestamps: true },
)

productTypeSchema.plugin(mongooseAggregatePaginate);
export const ProductType = mongoose.model("ProductType", productTypeSchema)
 