import mongoose, { Schema } from "mongoose";
import { PAYOUT_STATUS } from "../constants.js";

const payoutSchema = new Schema(
  {
    orderId: { type: Schema.Types.ObjectId, ref: "Order", default: null },
    sellerId: { type: Schema.Types.ObjectId, ref: "Seller", required: true, index: true },
    
    requestType: { 
      type: String, 
      enum: ['scheduled', 'manual'], 
      default: 'scheduled',
      index: true 
    },
    
    grossAmount: { type: Number, required: true },
    commissionAmount: { type: Number, required: true },
    netAmount: { type: Number, required: true },
    currency: { type: String, default: "USD" },
    
    status: { 
      type: String, 
      enum: [...PAYOUT_STATUS, "requested", "processing"], 
      default: "pending", 
      index: true 
    },
    holdUntil: { type: Date, index: true },
    
    requestReason: { type: String, default: null },
    requestedAt: { type: Date, default: null },
    
    processedAt: { type: Date, default: null },
    processedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    
    paypalBatchId: { type: String, default: null },
    paypalItemId: { type: String, default: null },
    paypalTransactionId: { type: String, default: null },
    
    notes: { type: String, default: "" },
    blockReason: { type: String, default: null },
    failedReason: { type: String, default: null },
    retryCount: { type: Number, default: 0 },
    maxRetries: { type: Number, default: 3 },
    lastRetryAt: { type: Date, default: null },
    metadata: {
      type: Schema.Types.Mixed,
      default: null,
    },
  },
  { timestamps: true }
);

payoutSchema.index({ sellerId: 1, status: 1 });
payoutSchema.index({ sellerId: 1, requestType: 1, createdAt: -1 });
payoutSchema.index({ holdUntil: 1, status: 1 });
payoutSchema.index({ orderId: 1 }, { sparse: true });

export const Payout = mongoose.model("Payout", payoutSchema);
