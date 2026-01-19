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
    isRefunded: { type: Boolean, default: false }, // Mark as refunded permanently
    refundedAt: Date, // When this key/account was refunded
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

// Note: productId index is created automatically by unique: true, no need for explicit index
licenseKeySchema.index({ 'keys.isUsed': 1 });

export const LicenseKey = mongoose.model("LicenseKey", licenseKeySchema);
