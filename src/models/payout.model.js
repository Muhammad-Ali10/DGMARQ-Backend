import mongoose from "mongoose";
import { ORDER_STATUS, PAYMENT_STATUS, PAYOUT_STATUS } from "../constants.js";


// This table tracks per-seller, per-order payouts. For multi-seller orders there will be one payout per seller per order.
const payoutSchema = new Schema(
  {
    orderId: { type: Schema.Types.ObjectId, ref: "Order", required: true, index: true },
    sellerId: { type: Schema.Types.ObjectId, ref: "Seller", required: true, index: true },
    amount: { type: Number, required: true }, // seller share
    adminCommission: { type: Number, required: true },
    netAmount: { type: Number, required: true },
    currency: { type: String, default: "EUR" },
    status: { type: String, enum: PAYOUT_STATUS, default: "pending", index: true },
    holdUntil: { type: Date }, // order paidAt + 15 days
    paypalPayoutBatchId: String,
    paypalTransactionId: String,
    notes: String,
  },
  { timestamps: true },
)

payoutSchema.index({ sellerId: 1, status: 1 })

export const Payout = mongoose.model("Payout", payoutSchema)
