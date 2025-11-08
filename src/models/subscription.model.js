import mongoose from "mongoose";
import { SUB_STATUS } from "../constants.js";


const subscriptionSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    planName: { type: String, required: true }, // Dgmarq+
    startDate: Date,
    endDate: Date,
    status: { type: String, enum: SUB_STATUS, default: "active" },
  },
  { timestamps: true },
)

export const Subscription = mongoose.model("Subscription", subscriptionSchema)
