import mongoose from "mongoose";

const conversationSchema = new mongoose.Schema({
  buyerId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  sellerId: { type: mongoose.Schema.Types.ObjectId, ref: "Seller", required: true, index: true },
  productId: { type: mongoose.Schema.Types.ObjectId, ref: "Product", default: null },
  orderId: { type: mongoose.Schema.Types.ObjectId, ref: "Order", required: false },
  status: { type: String, enum: ["active", "closed", "blocked"], default: "active", index: true },
  lastMessage: String,
  lastMessageAt: { type: Date, index: true },
  unreadCountBuyer: { type: Number, default: 0 },
  unreadCountSeller: { type: Number, default: 0 },
  lastReadByBuyer: Date,
  lastReadBySeller: Date,
  archivedByBuyer: { type: Boolean, default: false },
  archivedBySeller: { type: Boolean, default: false },
}, { timestamps: true });

conversationSchema.index({ buyerId: 1, lastMessageAt: -1 });
conversationSchema.index({ sellerId: 1, lastMessageAt: -1 });
conversationSchema.index({ status: 1, lastMessageAt: -1 });
conversationSchema.index({ buyerId: 1, status: 1, lastMessageAt: -1 });
conversationSchema.index({ sellerId: 1, status: 1, lastMessageAt: -1 });
conversationSchema.index({ orderId: 1 });

// Purpose: Manages messaging conversations between buyers and sellers
export const Conversation = mongoose.model("Conversation", conversationSchema);
