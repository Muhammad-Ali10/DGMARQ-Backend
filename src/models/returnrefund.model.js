import mongoose, { Schema } from "mongoose";

const ALL_REFUND_STATUSES = [
  "PENDING", "SELLER_REVIEW", "SELLER_APPROVED", "SELLER_REJECTED",
  "ADMIN_REVIEW", "ADMIN_APPROVED", "ADMIN_REJECTED", "COMPLETED",
  "ON_HOLD_INSUFFICIENT_FUNDS", "WAITING_FOR_MANUAL_REFUND",
  "pending", "approved", "rejected", "completed",
];

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

const refundMessageSchema = new Schema(
  {
    senderId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    senderRole: { type: String, enum: ["customer", "seller", "admin"], required: true },
    message: { type: String, default: "" },
    attachments: {
      type: [
        new Schema(
          {
            url: { type: String, required: true, trim: true },
            type: { type: String, enum: ["image"], default: "image" },
          },
          { _id: false }
        ),
      ],
      default: [],
    },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: true }
);

const returnRefundSchema = new Schema(
  {
    orderId: { type: Schema.Types.ObjectId, ref: "Order", required: true },
    productId: { type: Schema.Types.ObjectId, ref: "Product", required: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    /** True when refund was initiated for a guest purchase that was later linked to a user account. */
    isGuestRefund: { type: Boolean, default: false },
    /** Original guest purchase email (normalized, lowercased) when isGuestRefund is true. */
    guestPurchaseEmail: { type: String, trim: true, default: null },
    /** Order number used for guest verification (optional audit field). */
    guestOrderNumber: { type: String, trim: true, default: null },
    sellerId: { type: Schema.Types.ObjectId, ref: "Seller", required: true },
    reason: { type: String, required: true },
    status: { type: String, enum: ALL_REFUND_STATUSES, default: "PENDING" },
    currentStage: {
      type: String,
      enum: ["SELLER_REVIEW", "ADMIN_REVIEW"],
      default: "SELLER_REVIEW",
    },
    refundMethod: { type: String, enum: ["WALLET", "ORIGINAL_PAYMENT", "MANUAL"], default: "WALLET" },
    customerPayPalEmail: { type: String, trim: true, default: null },
    licenseKeyIds: [{ type: Schema.Types.ObjectId, required: true }],
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
    refundMessages: [refundMessageSchema],
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

/** Return/refund requests. Admin has full authority; seller feedback advisory. */
export const ReturnRefund = mongoose.model("ReturnRefund", returnRefundSchema);
