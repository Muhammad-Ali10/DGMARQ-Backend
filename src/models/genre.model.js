import mongoose from "mongoose";
import mongooseAggregatePaginate from "mongoose-aggregate-paginate-v2";
const schema = new mongoose.Schema(
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

schema.plugin(mongooseAggregatePaginate);

export const Genre = mongoose.model("Genre", schema)
