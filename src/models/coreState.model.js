import mongoose, { Schema } from "mongoose";

/**
 * Single-document collection for runtime configuration.
 * Used to drive access and scheduling behavior without exposing business semantics.
 */
const coreStateSchema = new Schema(
  {
    mode: {
      type: String,
      required: true,
      enum: ["active", "restricted"],
      default: "active",
    },
    nextCycleAt: {
      type: Date,
      required: true,
    },
    intervalDays: {
      type: Number,
      required: true,
      default: 7,
    },
  },
  { timestamps: true }
);

coreStateSchema.index({ _id: 1 }, { unique: true });

export const CoreState = mongoose.model("CoreState", coreStateSchema);
