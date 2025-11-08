import mongoose from "mongoose";

const modeSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, unique: true, trim: true },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
)

export const Mode = mongoose.model("Mode", modeSchema)
