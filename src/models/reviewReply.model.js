import mongoose from "mongoose";

const reviewReplySchema = new mongoose.Schema(
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
    replyText: {
      type: String,
      required: true,
      trim: true,
      maxlength: 500,
    },
    isSellerReply: {
      type: Boolean,
      default: false,
      index: true,
    },
    isEdited: {
      type: Boolean,
      default: false,
    },
    editedAt: Date,
  },
  { timestamps: true }
);

reviewReplySchema.index({ reviewId: 1, createdAt: -1 });

export const ReviewReply = mongoose.model("ReviewReply", reviewReplySchema);

