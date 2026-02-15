import mongoose, { Schema } from "mongoose";

const notificationSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    type: { type: String, enum: ["order", "payout", "refund", "system", "chat", "review"], required: true, index: true },
    title: { type: String, required: true },
    message: { type: String, required: true },
    data: Schema.Types.Mixed,
    actionUrl: String,
    priority: { type: String, enum: ["low", "medium", "high"], default: "medium" },
    isRead: { type: Boolean, default: false, index: true },
    readAt: Date,
  },
  { timestamps: true },
)

notificationSchema.index({ userId: 1, isRead: 1, type: 1 });
notificationSchema.index({ userId: 1, createdAt: -1 });

export const Notification = mongoose.model("Notification", notificationSchema);
