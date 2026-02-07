import mongoose from "mongoose";
import mongooseAggregatePaginate from "mongoose-aggregate-paginate-v2";

const schema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
  },
  { timestamps: true }
);
schema.plugin(mongooseAggregatePaginate);
// Purpose: Represents product themes or visual styles for categorization
export const Theme = mongoose.model("Theme", schema);
  