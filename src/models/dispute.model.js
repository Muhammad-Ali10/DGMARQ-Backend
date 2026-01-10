import mongoose, { Schema } from "mongoose";
import { REFUND_STATUS } from "../constants.js";

const disputeSchema = new Schema(
  {
    orderId: {
      type: Schema.Types.ObjectId,
      ref: "Order",
      required: true,
      index: true,
    },
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    sellerId: {
      type: Schema.Types.ObjectId,
      ref: "Seller",
      required: true,
      index: true,
    },
    type: {
      type: String,
      enum: ['key_not_working', 'wrong_key', 'key_already_used', 'product_mismatch', 'other'],
      required: true,
    },
    reason: {
      type: String,
      required: true,
    },
    status: {
      type: String,
      enum: ['open', 'investigating', 'resolved', 'rejected'],
      default: 'open',
      index: true,
    },
    adminId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    adminNotes: String,
    resolution: String,
    refundAmount: Number,
    refundStatus: {
      type: String,
      enum: REFUND_STATUS,
      default: 'pending',
    },
    evidence: [String], // URLs to evidence files/images
    createdAt: Date,
    resolvedAt: Date,
  },
  { timestamps: true }
);

disputeSchema.index({ userId: 1, status: 1 });
disputeSchema.index({ sellerId: 1, status: 1 });
disputeSchema.index({ status: 1, createdAt: -1 });

export const Dispute = mongoose.model("Dispute", disputeSchema);

