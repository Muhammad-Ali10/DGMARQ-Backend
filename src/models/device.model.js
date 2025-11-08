import mongoose from "mongoose";

const schema = new mongoose.Schema(
  {
    name: { type: String, required: true, unique: true, trim: true },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
)

export const Device = mongoose.model("Device", schema)
