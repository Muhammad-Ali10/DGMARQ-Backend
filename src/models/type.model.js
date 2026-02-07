import mongoose from "mongoose";
import mongooseAggregatePaginate from "mongoose-aggregate-paginate-v2";

const type = new mongoose.Schema(
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

type.plugin(mongooseAggregatePaginate);
// Purpose: Represents product types for classification and filtering
export const Type = mongoose.model("Type", type)
 