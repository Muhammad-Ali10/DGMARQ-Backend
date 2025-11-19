import mongoose, { Schema } from "mongoose";
import { PAYOUT_STATUS } from "../constants.js";

const payoutSchema = new Schema(
  {
    orderId: { type: Schema.Types.ObjectId, ref: "Order", required: true, index: true },
    sellerId: { type: Schema.Types.ObjectId, ref: "Seller", required: true, index: true },
    amount: { type: Number, required: true },
    adminCommission: { type: Number, required: true },
    netAmount: { type: Number, required: true },
    currency: { type: String, default: "EUR" },
    status: { type: String, enum: PAYOUT_STATUS, default: "pending", index: true },
    holdUntil: { type: Date },
    paypalPayoutBatchId: { type: String, default: null },
    paypalTransactionId: { type: String, default: null },
    notes: { type: String, default: "" },
  },
  { timestamps: true }
);

payoutSchema.index({ sellerId: 1, status: 1 });

export const Payout = mongoose.model("Payout", payoutSchema);
