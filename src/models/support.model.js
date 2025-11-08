import mongoose from "mongoose";
import { SUPPORT_STATUS } from "../constants.js";

const supportChatSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true }, // customer
    adminId: { type: Schema.Types.ObjectId, ref: "User", required: true }, // admin/support
    status: { type: String, enum: SUPPORT_STATUS, default: "open" },
  },
  { timestamps: true },
)

supportChatSchema.index({ userId: 1, adminId: 1, status: 1 })

export const SupportChat = mongoose.model("SupportChat", supportChatSchema)
