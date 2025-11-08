import mongoose from "mongoose";

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

export const Region = mongoose.model("Region", schema)
