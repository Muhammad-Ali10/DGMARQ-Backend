import mongoose from "mongoose";
import mongooseAggregatePaginate from "mongoose-aggregate-paginate-v2";

const modeSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, unique: true, trim: true },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

modeSchema.plugin(mongooseAggregatePaginate);
export const Mode = mongoose.model("Mode", modeSchema);
