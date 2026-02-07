import mongoose, { Schema } from "mongoose";

const homepageSliderSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    image: { type: String, required: true },
    productId: { type: Schema.Types.ObjectId, ref: "Product", index: true, default: null },
    link: String,
    slideIndex: { type: Number, default: 0, index: true },
    order: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true, index: true },
  },
  { timestamps: true },
)

// Purpose: Manages homepage carousel slides with images and product links
export const HomepageSlider = mongoose.model("HomepageSlider", homepageSliderSchema)
