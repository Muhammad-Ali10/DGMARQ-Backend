import mongoose, { Schema } from "mongoose";
import { SUPPORT_STATUS } from "../constants.js";

const supportChatSchema = new Schema(
  {
    userId: { 
      type: Schema.Types.ObjectId, 
      ref: "User", 
      default: null,
      index: true 
    },
    guestEmail: { type: String, default: null },
    guestName: { type: String, default: null },
    guestSessionId: { type: String, default: null, index: true },
    adminId: { 
      type: Schema.Types.ObjectId, 
      ref: "User", 
      default: null,
      index: true 
    },
    subject: { type: String, default: "General Inquiry" },
    status: { 
      type: String, 
      enum: SUPPORT_STATUS, 
      default: "open",
      index: true 
    },
    priority: {
      type: String,
      enum: ["low", "medium", "high", "urgent"],
      default: "medium",
    },
    lastMessageAt: { type: Date, default: Date.now },
    lastMessage: { type: String, default: null },
    unreadCountUser: { type: Number, default: 0 },
    unreadCountAdmin: { type: Number, default: 0 },
    lastReadByUser: Date,
    lastReadByAdmin: Date,
    closedAt: Date,
    closedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    resolvedAt: Date,
    resolutionNotes: String,
  },
  { timestamps: true },
)

supportChatSchema.index({ userId: 1, status: 1 });
supportChatSchema.index({ adminId: 1, status: 1 });
supportChatSchema.index({ guestSessionId: 1, status: 1 });
supportChatSchema.index({ status: 1, createdAt: -1 });

// Purpose: Virtual property that checks if the chat is from an anonymous/guest user
supportChatSchema.virtual('isAnonymous').get(function() {
  return !this.userId;
});

// Purpose: Virtual property that returns a unique identifier for the user or guest
supportChatSchema.virtual('userIdentifier').get(function() {
  if (this.userId) {
    return this.userId.toString();
  }
  return this.guestEmail || this.guestSessionId || 'anonymous';
});

// Purpose: Represents a support chat session between users/guests and admin support staff
export const SupportChat = mongoose.model("SupportChat", supportChatSchema);
