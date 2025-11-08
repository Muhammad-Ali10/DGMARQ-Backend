import mongoose from "mongoose";

const homepageSliderSchema = new mongoose.Schema(
  {
    title: String,
    image: String,
    productId: { type: Schema.Types.ObjectId, ref: "Product" },
    link: String,
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
)

export const HomepageSlider = mongoose.model("HomepageSlider", homepageSliderSchema)
