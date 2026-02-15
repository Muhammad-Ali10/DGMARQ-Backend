import mongoose, { Schema } from "mongoose";

const supportMessageSchema = new Schema(
  {
    supportChatId: { 
      type: Schema.Types.ObjectId, 
      ref: "SupportChat", 
      required: true,
      index: true 
    },
    senderId: { 
      type: Schema.Types.ObjectId, 
      ref: "User", 
      default: null,
      index: true 
    },
    senderName: { type: String, default: null },
    senderEmail: { type: String, default: null },
    senderType: {
      type: String,
      enum: ["user", "admin", "guest"],
      required: true,
      index: true,
    },
    messageText: { type: String, required: true },
    messageType: { 
      type: String, 
      enum: ["text", "image", "file", "system"], 
      default: "text" 
    },
    attachment: { type: String, default: null },
    isRead: { type: Boolean, default: false, index: true },
    readAt: Date,
    isEdited: { type: Boolean, default: false },
    editedAt: Date,
    isDeleted: { type: Boolean, default: false },
    deletedAt: Date,
    sentAt: { type: Date, default: Date.now, index: true },
  },
  { timestamps: true }
);

supportMessageSchema.index({ supportChatId: 1, sentAt: -1 });
supportMessageSchema.index({ senderId: 1, sentAt: -1 });
supportMessageSchema.index({ senderType: 1, sentAt: -1 });

export const SupportMessage = mongoose.model("SupportMessage", supportMessageSchema);

