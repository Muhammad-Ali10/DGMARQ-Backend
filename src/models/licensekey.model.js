import e from "express";
import mongoose from "mongoose";

// NOTE: keyData MUST be encrypted before storing. We store metadata only here.
// Store minimal info, avoid plaintext secrets in DB.
const licenseKeySchema = new mongoose.Schema(
  {
    productId: { type: Schema.Types.ObjectId, ref: "Product", required: true, index: true },
    keyData: { type: String, required: true }, // encrypted JSON string (username/password/license etc.) - encrypt in app before save
    isUsed: { type: Boolean, default: false, index: true },
    assignedTo: { type: Schema.Types.ObjectId, ref: "OrderItem", default: null },
    metadata: Schema.Types.Mixed, // optional: e.g., region tag etc.
  },
  { timestamps: true },
)

licenseKeySchema.index({ productId: 1, isUsed: 1 })

export const LicenseKey = mongoose.model("LicenseKey", licenseKeySchema)
