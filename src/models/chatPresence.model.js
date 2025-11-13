import mongoose from "mongoose";

const chatPresenceSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  isOnline: { type: Boolean, default: false },
  lastSeen: Date
});

export const ChatPresence = mongoose.model("ChatPresence", chatPresenceSchema);
