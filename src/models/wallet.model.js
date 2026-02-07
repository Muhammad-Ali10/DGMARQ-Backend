import mongoose, { Schema } from "mongoose";

const walletTransactionSchema = new Schema(
  {
    type: {
      type: String,
      enum: ['credit', 'debit'],
      required: true,
    },
    amount: {
      type: Number,
      required: true,
      min: 0,
    },
    description: {
      type: String,
      required: true,
    },
    orderId: {
      type: Schema.Types.ObjectId,
      ref: "Order",
      default: null,
    },
    refundId: {
      type: Schema.Types.ObjectId,
      ref: "ReturnRefund",
      default: null,
    },
    metadata: {
      type: Schema.Types.Mixed,
      default: {},
    },
  },
  { timestamps: true }
);

const walletSchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
    },
    balance: {
      type: Number,
      default: 0,
      min: 0,
    },
    currency: {
      type: String,
      default: "USD",
    },
    transactions: [walletTransactionSchema],
  },
  { timestamps: true }
);

walletSchema.index({ userId: 1 });
walletSchema.index({ "transactions.orderId": 1 });
walletSchema.index({ "transactions.refundId": 1 });

// Purpose: Represents user wallet with balance and transaction history for payments and refunds
export const Wallet = mongoose.model("Wallet", walletSchema);
