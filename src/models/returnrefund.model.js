import mongoose from "mongoose";
import { REFUND_STATUS } from "../constants.js";

const returnRefundSchema = new Schema(
  {
    orderItemId: { type: Schema.Types.ObjectId, required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    reason: String,
    status: { type: String, enum: REFUND_STATUS, default: "pending" },
  },
  { timestamps: true },
)
export const ReturnRefund = mongoose.model("ReturnRefund", returnRefundSchema)
