import mongoose, { Schema } from "mongoose";

const auditLogSchema = new Schema(
  {
    action: {
      type: String,
      required: true,
      index: true,
    },
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      index: true,
    },
    entityType: {
      type: String,
      required: true,
      index: true,
    },
    entityId: {
      type: Schema.Types.ObjectId,
      index: true,
    },
    metadata: Schema.Types.Mixed,
    ipAddress: String,
    userAgent: String,
    status: {
      type: String,
      enum: ['success', 'failed', 'pending'],
      default: 'success',
    },
    error: String,
  },
  { timestamps: true }
);

auditLogSchema.index({ entityType: 1, entityId: 1 });
auditLogSchema.index({ userId: 1, createdAt: -1 });
auditLogSchema.index({ action: 1, createdAt: -1 });

// Purpose: Records system actions and events for audit trail and compliance tracking
export const AuditLog = mongoose.model("AuditLog", auditLogSchema);

