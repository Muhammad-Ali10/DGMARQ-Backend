import mongoose, { Schema } from "mongoose";

const keyItemSchema = new Schema(
  {
    keyData: { type: String, required: true },
    keyType: {
      type: String,
      enum: ['steam', 'epic', 'origin', 'xbox', 'playstation', 'nintendo', 'account', 'other'],
      default: 'other'
    },
    isUsed: { type: Boolean, default: false },
    isRefunded: { type: Boolean, default: false },
    refundedAt: Date,
    assignedTo: { type: Schema.Types.ObjectId, ref: "OrderItem", default: null },
    assignedToOrder: { type: Schema.Types.ObjectId, ref: "Order", default: null },
    assignedAt: Date,
    encryptedAt: Date,
    emailSent: { type: Boolean, default: false },
    emailSentAt: Date,
    metadata: Schema.Types.Mixed,
  },
  { _id: true }
);

const licenseKeySchema = new Schema(
  {
    productId: { 
      type: Schema.Types.ObjectId, 
      ref: "Product", 
      required: true, 
      unique: true
    },
    keys: [keyItemSchema],
  },
  { timestamps: true },
);

licenseKeySchema.index({ 'keys.isUsed': 1 });

// Purpose: Stores license keys and account credentials linked to products for digital delivery
export const LicenseKey = mongoose.model("LicenseKey", licenseKeySchema);
