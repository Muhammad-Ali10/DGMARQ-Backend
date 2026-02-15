import mongoose from "mongoose";

const messageSchema = new mongoose.Schema({
  conversationId: { type: mongoose.Schema.Types.ObjectId, ref: "Conversation", required: true, index: true },
  senderId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  receiverId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  messageText: String,
  messageType: { type: String, enum: ["text", "image", "file"], default: "text" },
  attachment: { type: String, default: null },
  uploadStatus: { type: String, enum: ["pending", "completed", "failed"], default: null },
  attachmentMetadata: {
    publicId: String,
    width: Number,
    height: Number,
  },
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

messageSchema.index({ conversationId: 1, sentAt: -1 });
messageSchema.index({ conversationId: 1, receiverId: 1, isRead: 1 });
messageSchema.index({ conversationId: 1, isDeleted: 1, sentAt: -1 });

export const Message = mongoose.model("Message", messageSchema);
