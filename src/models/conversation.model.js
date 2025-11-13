import mongoose from "mongoose";

const conversationSchema = new mongoose.Schema({
  buyerId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  sellerId: { type: mongoose.Schema.Types.ObjectId, ref: "Seller" },
  productId: { type: mongoose.Schema.Types.ObjectId, ref: "Product", default: null },
  status: { type: String, enum: ["active", "closed", "blocked"], default: "active" },
  lastMessage: String,
  lastMessageAt: Date
}, { timestamps: true });

export const Conversation = mongoose.model("Conversation", conversationSchema);
