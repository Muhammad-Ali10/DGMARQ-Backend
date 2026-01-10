import mongoose, { Schema } from "mongoose";

const homepageSliderSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    image: { type: String, required: true },
    productId: { type: Schema.Types.ObjectId, ref: "Product", index: true, default: null },
    link: String,
    slideIndex: { type: Number, default: 0, index: true }, // Position in carousel (0-4: left small, left medium, center, right medium, right small)
    order: { type: Number, default: 0 }, // For ordering sliders (backward compatibility)
    isActive: { type: Boolean, default: true, index: true },
  },
  { timestamps: true },
)

export const HomepageSlider = mongoose.model("HomepageSlider", homepageSliderSchema)
