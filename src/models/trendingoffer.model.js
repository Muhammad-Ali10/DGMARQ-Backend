import mongoose, { Schema } from "mongoose";

const trendingOfferSchema = new mongoose.Schema(
  {
    products: [
      {
        type: Schema.Types.ObjectId,
        ref: "Product",
        required: true,
        index: true,
      },
    ],
    discountPercent: {
      type: Number,
      required: true,
      min: 0,
      max: 100,
    },
    startTime: {
      type: Date,
      required: true,
      index: true,
    },
    endTime: {
      type: Date,
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: ["active", "expired", "scheduled"],
      default: "scheduled",
      index: true,
    },
  },
  { timestamps: true }
);

// Index for efficient querying of active offers
trendingOfferSchema.index({ status: 1, startTime: 1, endTime: 1 });
trendingOfferSchema.index({ products: 1, status: 1 });

export const TrendingOffer = mongoose.model("TrendingOffer", trendingOfferSchema);

