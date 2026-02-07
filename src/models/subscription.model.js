import mongoose, { Schema } from "mongoose";
import { SUB_STATUS } from "../constants.js";

const subscriptionSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    planName: { type: String, required: true },
    startDate: Date,
    endDate: Date,
    status: { type: String, enum: SUB_STATUS, default: "active", index: true },
    paypalSubscriptionId: { type: String, default: null, index: true },
    paypalPlanId: { type: String, default: null },
    paypalBillingAgreementId: { type: String, default: null },
    nextBillingDate: Date,
    cancelledAt: Date,
    cancellationReason: String,
  },
  { timestamps: true },
)

// Purpose: Tracks user subscription plans and billing information
export const Subscription = mongoose.model("Subscription", subscriptionSchema)
