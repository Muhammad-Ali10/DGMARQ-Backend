import mongoose from "mongoose";

const reviewVoteSchema = new mongoose.Schema(
  {
    reviewId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Review",
      required: true,
      index: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    isHelpful: {
      type: Boolean,
      required: true,
    },
  },
  { timestamps: true }
);

reviewVoteSchema.index({ reviewId: 1, userId: 1 }, { unique: true });

export const ReviewVote = mongoose.model("ReviewVote", reviewVoteSchema);

