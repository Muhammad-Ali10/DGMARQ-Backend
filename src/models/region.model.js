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
// Purpose: Represents a geographic region for location-based organization
export const Region = mongoose.model("Region", schema)
