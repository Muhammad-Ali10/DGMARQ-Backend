import mongoose from "mongoose";
import mongooseAggregatePaginate from "mongoose-aggregate-paginate-v2";
const schema = new mongoose.Schema(
  {
    name: { type: String, required: true, unique: true, trim: true },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
)
schema.plugin(mongooseAggregatePaginate);

// Purpose: Stores device types for product compatibility classification
export const Device = mongoose.model("Device", schema)
