import mongoose, { Schema } from "mongoose";

const emailLogSchema = new Schema(
  {
    recipient: { type: String, required: true, index: true },
    subject: { type: String, required: true },
    template: { type: String, enum: ['licenseKey', 'orderConfirmation', 'payoutNotification', 'passwordReset', 'emailVerification', 'emailVerificationOTP', 'outOfStock'], required: true },
    status: { type: String, enum: ['pending', 'sent', 'failed'], default: 'pending', index: true },
    orderId: { type: Schema.Types.ObjectId, ref: 'Order', default: null },
    keyId: { type: Schema.Types.ObjectId, ref: 'LicenseKey', default: null },
    sentAt: Date,
    error: String,
  },
  { timestamps: true }
);

emailLogSchema.index({ recipient: 1, status: 1 });
emailLogSchema.index({ orderId: 1 });

export const EmailLog = mongoose.model("EmailLog", emailLogSchema);

