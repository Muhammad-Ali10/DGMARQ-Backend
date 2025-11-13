import mongoose from "mongoose";

const messageSchema = new mongoose.Schema({
  conversationId: { type: mongoose.Schema.Types.ObjectId, ref: "Conversation" },
  senderId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  receiverId: { type: mongoose.Schema.Types.ObjectId, ref: "User" }, // always User type
  messageText: String,
  messageType: { type: String, enum: ["text", "image", "file"], default: "text" },
  attachment: { type: String, default: null },
  isRead: { type: Boolean, default: false },
  sentAt: { type: Date, default: Date.now }
});

export const Message = mongoose.model("Message", messageSchema);
