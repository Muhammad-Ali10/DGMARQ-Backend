import mongoose from "mongoose";

const messageSchema = new mongoose.Schema({
  conversationId: { type: mongoose.Schema.Types.ObjectId, ref: "Conversation", required: true, index: true },
  senderId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  receiverId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true }, // always User type
  messageText: String,
  messageType: { type: String, enum: ["text", "image", "file"], default: "text" },
  attachment: { type: String, default: null },
  isRead: { type: Boolean, default: false, index: true },
  isEdited: { type: Boolean, default: false },
  editedAt: Date,
  isDeleted: { type: Boolean, default: false },
  deletedAt: Date,
  reactions: [{
    emoji: String,
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" }
  }],
  sentAt: { type: Date, default: Date.now, index: true }
}, { timestamps: true });

// Compound indexes for optimized queries
// Critical: conversationId + sentAt for efficient message fetching with sorting
messageSchema.index({ conversationId: 1, sentAt: -1 });
// For marking messages as read (compound index for updateMany operations)
messageSchema.index({ conversationId: 1, receiverId: 1, isRead: 1 });
// For filtering non-deleted messages efficiently
messageSchema.index({ conversationId: 1, isDeleted: 1, sentAt: -1 });

export const Message = mongoose.model("Message", messageSchema);
