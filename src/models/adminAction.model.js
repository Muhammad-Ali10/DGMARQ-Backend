import mongoose, { Schema } from "mongoose";

const adminActionSchema = new Schema(
  {
    adminId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    action: {
      type: String,
      required: true,
      index: true,
    }, // 'seller_approved', 'seller_rejected', 'product_approved', 'product_rejected', 'user_banned', 'payout_processed', etc.
    entityType: {
      type: String,
      required: true,
      index: true,
    }, // 'Seller', 'Product', 'User', 'Payout', 'Dispute', etc.
    entityId: {
      type: Schema.Types.ObjectId,
      required: true,
      index: true,
    },
    details: {
      type: String,
      default: "",
    },
    reason: String,
    metadata: Schema.Types.Mixed,
    ipAddress: String,
    userAgent: String,
  },
  { timestamps: true }
);

adminActionSchema.index({ adminId: 1, createdAt: -1 });
adminActionSchema.index({ entityType: 1, entityId: 1 });
adminActionSchema.index({ action: 1, createdAt: -1 });

export const AdminAction = mongoose.model("AdminAction", adminActionSchema);

