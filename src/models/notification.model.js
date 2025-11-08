import mongoose from "mongoose";

const notificationSchema = new mongoose.Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", index: true },
    type: { type: String, enum: ["order", "payout", "refund", "system"] },
    message: String,
    isRead: { type: Boolean, default: false },
  },
  { timestamps: true },
)

export const Notification = mongoose.model("Notification", notificationSchema)
