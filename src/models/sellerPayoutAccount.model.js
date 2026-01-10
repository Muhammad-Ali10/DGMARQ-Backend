import mongoose, { Schema } from "mongoose";

const sellerPayoutAccountSchema = new Schema(
  {
    sellerId: {
      type: Schema.Types.ObjectId,
      ref: "Seller",
      required: true,
      unique: true,
      index: true,
    },
    accountType: {
      type: String,
      enum: ["paypal"],
      required: true,
    },
    accountIdentifier: {
      type: String,
      required: true,
      // For PayPal: email (encrypted)
      // For Bank: account number (encrypted)
      // For Platform: platform-specific identifier
    },
    encryptedAccountIdentifier: {
      type: String,
      required: true,
      // Encrypted version of accountIdentifier (AES-256-GCM)
    },
    provider: {
      type: String,
      enum: ["paypal"],
      default: "paypal",
    },
    status: {
      type: String,
      enum: ["pending", "verified", "blocked"],
      default: "pending",
      index: true,
    },
    accountName: {
      type: String,
      // Account holder name (for bank accounts)
    },
    bankName: {
      type: String,
      // Bank name (for bank accounts)
    },
    verifiedAt: {
      type: Date,
      default: null,
    },
    verifiedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    linkedAt: {
      type: Date,
      default: Date.now,
    },
    blockedAt: {
      type: Date,
      default: null,
    },
    blockedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    blockedReason: {
      type: String,
      default: null,
    },
    notes: {
      type: String,
      default: null,
    },
  },
  { timestamps: true }
);

sellerPayoutAccountSchema.index({ sellerId: 1, status: 1 });
sellerPayoutAccountSchema.index({ provider: 1, status: 1 });

export const SellerPayoutAccount = mongoose.model("SellerPayoutAccount", sellerPayoutAccountSchema);

