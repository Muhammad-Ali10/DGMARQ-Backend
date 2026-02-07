import mongoose, { Schema } from "mongoose";

// Include new flow statuses + legacy for backward compatibility
const ALL_REFUND_STATUSES = [
  "PENDING", "SELLER_REVIEW", "SELLER_APPROVED", "SELLER_REJECTED",
  "ADMIN_REVIEW", "ADMIN_APPROVED", "ADMIN_REJECTED", "COMPLETED",
  "ON_HOLD_INSUFFICIENT_FUNDS", "WAITING_FOR_MANUAL_REFUND",
  "pending", "approved", "rejected", "completed", // legacy
];

// Embedded audit entry for refund workflow. Append-only: only push new entries; never update or delete.
const refundHistoryEntrySchema = new Schema(
  {
    actor: { type: String, enum: ["customer", "seller", "admin", "system"], required: true },
    action: { type: String, required: true },
    previousStatus: { type: String, required: false },
    newStatus: { type: String, required: false },
    notes: { type: String, required: false },
    timestamp: { type: Date, default: Date.now, required: true },
  },
  { _id: false }
);

// Refund-scoped internal chat (customer ↔ admin; seller read-only unless admin requests input)
const refundMessageSchema = new Schema(
  {
    senderId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    senderRole: { type: String, enum: ["customer", "seller", "admin"], required: true },
    message: { type: String, required: true },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: true }
);

const returnRefundSchema = new Schema(
  {
    orderId: { type: Schema.Types.ObjectId, ref: "Order", required: true },
    productId: { type: Schema.Types.ObjectId, ref: "Product", required: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    sellerId: { type: Schema.Types.ObjectId, ref: "Seller", required: true },
    reason: { type: String, required: true },
    status: { type: String, enum: ALL_REFUND_STATUSES, default: "PENDING" },
    currentStage: {
      type: String,
      enum: ["SELLER_REVIEW", "ADMIN_REVIEW"],
      default: "SELLER_REVIEW",
    },
    // Refund method: WALLET (seller review) or ORIGINAL_PAYMENT (admin-handled manual PayPal)
    refundMethod: { type: String, enum: ["WALLET", "ORIGINAL_PAYMENT", "MANUAL"], default: "WALLET" },
    // For ORIGINAL_PAYMENT: customer PayPal email for manual refund
    customerPayPalEmail: { type: String, trim: true, default: null },
    // License-key–level refund: exact keys to refund
    licenseKeyIds: [{ type: Schema.Types.ObjectId, required: true }],
    // Evidence image URLs (at least one required at creation; validated in controller)
    evidenceFiles: [String],
    refundAmount: Number,
    refundTransactionId: String,
    refundedAt: Date,
    manualRefundReference: { type: String, trim: true, default: null },
    adminNotes: String,
    rejectionReason: String,
    sellerDecisionReason: String,
    sellerDecisionAt: Date,
    sellerReviewStartedAt: { type: Date, default: null },
    sellerRespondedAt: { type: Date, default: null },
    sellerFeedback: { type: String, default: null },
    sellerFeedbackAt: { type: Date, default: null },
    refundHistory: [refundHistoryEntrySchema],
    // Refund-specific internal chat
    refundMessages: [refundMessageSchema],
    // Admin can request seller clarification; seller has 48h to reply
    adminRequestedSellerInput: { type: Boolean, default: false },
    adminRequestedSellerInputAt: Date,
    sellerRepliedAt: Date,
  },
  { timestamps: true }
);

returnRefundSchema.index({ orderId: 1, productId: 1, userId: 1 });
returnRefundSchema.index({ status: 1 });
returnRefundSchema.index({ sellerId: 1, status: 1 });
returnRefundSchema.index({ licenseKeyIds: 1 });

// Purpose: Tracks return and refund requests; admin has full authority; seller feedback is advisory only
export const ReturnRefund = mongoose.model("ReturnRefund", returnRefundSchema);
