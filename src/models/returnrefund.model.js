import mongoose, { Schema } from "mongoose";
import { REFUND_STATUS } from "../constants.js";

const returnRefundSchema = new Schema(
  {
    orderId: { type: Schema.Types.ObjectId, ref: "Order", required: true },
    productId: { type: Schema.Types.ObjectId, ref: "Product", required: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    sellerId: { type: Schema.Types.ObjectId, ref: "Seller", required: true },
    reason: { type: String, required: true },
    status: { type: String, enum: REFUND_STATUS, default: "pending" },
    refundAmount: Number,
    refundTransactionId: String, // PayPal refund transaction ID
    refundedAt: Date,
    adminNotes: String,
    rejectionReason: String, // Required when status is 'rejected'
  },
  { timestamps: true },
)

returnRefundSchema.index({ orderId: 1, productId: 1, userId: 1 });
returnRefundSchema.index({ status: 1 });
export const ReturnRefund = mongoose.model("ReturnRefund", returnRefundSchema)
