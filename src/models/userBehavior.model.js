import mongoose from "mongoose";

const userBehaviorSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      index: true,
    },
    sessionId: String,
    eventType: {
      type: String,
      required: true,
      enum: [
        "page_view",
        "product_view",
        "product_search",
        "add_to_cart",
        "remove_from_cart",
        "add_to_wishlist",
        "checkout_start",
        "checkout_complete",
        "purchase",
        "review_submit",
        "support_chat_start",
      ],
      index: true,
    },
    entityType: {
      type: String,
      enum: ["product", "category", "page", "cart", "checkout", "order"],
    },
    entityId: mongoose.Schema.Types.ObjectId,
    metadata: mongoose.Schema.Types.Mixed,
    deviceInfo: {
      userAgent: String,
      ipAddress: String,
      deviceType: String,
      browser: String,
      os: String,
    },
    timestamp: {
      type: Date,
      default: Date.now,
      index: true,
    },
  },
  { timestamps: true }
);

userBehaviorSchema.index({ userId: 1, timestamp: -1 });
userBehaviorSchema.index({ eventType: 1, timestamp: -1 });
userBehaviorSchema.index({ entityType: 1, entityId: 1 });

export const UserBehavior = mongoose.model("UserBehavior", userBehaviorSchema);

