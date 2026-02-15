import mongoose, { Schema } from "mongoose";

const transactionSchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      index: true,
    },
    sellerId: {
      type: Schema.Types.ObjectId,
      ref: "Seller",
      index: true,
    },
    orderId: {
      type: Schema.Types.ObjectId,
      ref: "Order",
    },
    payoutId: {
      type: Schema.Types.ObjectId,
      ref: "Payout",
    },
    type: {
      type: String,
      enum: ['payment', 'payout', 'refund', 'commission', 'fee'],
      required: true,
      index: true,
    },
    amount: {
      type: Number,
      required: true,
    },
    currency: {
      type: String,
      default: "USD",
    },
    status: {
      type: String,
      enum: ['pending', 'completed', 'failed', 'cancelled'],
      default: 'pending',
      index: true,
    },
    paymentMethod: {
      type: String,
      enum: ['PayPal', 'Card', 'Wallet', 'Wallet+Card', 'stripe', 'bank_transfer'],
      default: 'PayPal',
    },
    paypalTransactionId: String,
    paypalOrderId: String,
    paypalCaptureId: String,
    description: String,
    metadata: Schema.Types.Mixed,
  },
  { timestamps: true }
);

transactionSchema.index({ userId: 1, type: 1, createdAt: -1 });
transactionSchema.index({ sellerId: 1, type: 1, createdAt: -1 });
transactionSchema.index({ orderId: 1 });
transactionSchema.index({ payoutId: 1 });
transactionSchema.index({ status: 1, createdAt: -1 });

export const Transaction = mongoose.model("Transaction", transactionSchema);

