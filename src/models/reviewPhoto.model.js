import mongoose from "mongoose";

const reviewPhotoSchema = new mongoose.Schema(
  {
    reviewId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Review",
      required: true,
      index: true,
    },
    imageUrl: {
      type: String,
      required: true,
    },
    thumbnailUrl: String,
    order: {
      type: Number,
      default: 0,
    },
  },
  { timestamps: true }
);

reviewPhotoSchema.index({ reviewId: 1, order: 1 });

// Purpose: Stores photos attached to product reviews
export const ReviewPhoto = mongoose.model("ReviewPhoto", reviewPhotoSchema);

