import mongoose from "mongoose";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { SupportChat } from "../models/support.model.js";
import { SupportMessage } from "../models/supportMessage.model.js";
import { User } from "../models/user.model.js";
import {
  createSupportConversation,
  assignAdminToChat,
  getAllSupportChats,
  getSupportMessages,
  sendSupportMessage,
  markMessagesAsRead,
  closeSupportChat,
} from "../services/support.service.js";
import { auditLog } from "../services/audit.service.js";

// Purpose: Creates a support chat conversation for logged-in or anonymous users
const createSupportChat = asyncHandler(async (req, res) => {
  const userId = req.user?._id || null;
  const { subject, initialMessage, guestEmail, guestName, guestSessionId } = req.body;

  if (!initialMessage) {
    throw new ApiError(400, "Initial message is required");
  }

  if (!userId && !guestSessionId && !guestEmail) {
    throw new ApiError(400, "For anonymous users, guestSessionId or guestEmail is required");
  }

  const result = await createSupportConversation({
    userId,
    guestEmail,
    guestName,
    guestSessionId,
    subject,
    initialMessage,
  });

  const populatedChat = await SupportChat.findById(result.chat._id)
    .populate("userId", "name email profileImage")
    .populate("adminId", "name email profileImage");

  const populatedMessage = result.message
    ? await SupportMessage.findById(result.message._id)
        .populate("senderId", "name email profileImage")
    : null;

  return res.status(result.isNew ? 201 : 200).json(
    new ApiResponse(result.isNew ? 201 : 200, {
      chat: populatedChat,
      initialMessage: populatedMessage,
      isNew: result.isNew,
    }, result.isNew ? "Support chat created successfully" : "Existing support chat found")
  );
});

// Purpose: Retrieves support chats for logged-in users, guests, or assigned admin chats
const getMySupportChats = asyncHandler(async (req, res) => {
  const userId = req.user?._id || null;
  const isAdmin = req.user?.roles?.includes('admin') || false;
  const { guestSessionId } = req.query;

  let match = {};

  if (isAdmin) {
    match.adminId = userId;
  } else if (userId) {
    match.userId = userId;
  } else if (guestSessionId) {
    match.guestSessionId = guestSessionId;
  } else {
    throw new ApiError(400, "User identification required");
  }

  const chats = await SupportChat.find(match)
    .populate("userId", "name email profileImage")
    .populate("adminId", "name email profileImage")
    .sort({ lastMessageAt: -1, createdAt: -1 });

  return res.status(200).json(
    new ApiResponse(200, chats, "Support chats retrieved successfully")
  );
});

// Purpose: Retrieves support chat messages and marks them as read
const getSupportChatMessages = asyncHandler(async (req, res) => {
  const { chatId } = req.params;
  const userId = req.user?._id || null;
  const isAdmin = req.user?.roles?.includes('admin') || false;
  const { guestSessionId } = req.query;

  if (!mongoose.Types.ObjectId.isValid(chatId)) {
    throw new ApiError(400, "Invalid chat ID");
  }

  const userIdentifier = userId || guestSessionId;

  const messages = await getSupportMessages(chatId, userIdentifier, isAdmin);

  await markMessagesAsRead(chatId, userIdentifier, isAdmin);

  return res.status(200).json(
    new ApiResponse(200, {
      messages,
      total: messages.length,
    }, "Messages retrieved successfully")
  );
});

// Purpose: Sends a message in a support chat conversation
const sendSupportMessageHandler = asyncHandler(async (req, res) => {
  const { chatId } = req.params;
  const userId = req.user?._id || null;
  const isAdmin = req.user?.roles?.includes('admin') || false;
  const { messageText, messageType = 'text', guestName, guestEmail, guestSessionId } = req.body;

  if (!messageText) {
    throw new ApiError(400, "Message text is required");
  }

  if (!mongoose.Types.ObjectId.isValid(chatId)) {
    throw new ApiError(400, "Invalid chat ID");
  }

  const userIdentifier = userId || guestSessionId;

  const message = await sendSupportMessage({
    chatId,
    userId: userIdentifier,
    isAdmin,
    messageText,
    messageType,
    guestName,
    guestEmail,
  });

  const populatedMessage = await SupportMessage.findById(message._id)
    .populate("senderId", "name email profileImage");

  if (req.app.get('io')) {
    const io = req.app.get('io');
    io.to(`support_chat:${chatId}`).emit('support_message', populatedMessage);
  }

  return res.status(201).json(
    new ApiResponse(201, populatedMessage, "Message sent successfully")
  );
});

// Purpose: Closes a support chat conversation with optional resolution notes
const closeSupportChatHandler = asyncHandler(async (req, res) => {
  const { chatId } = req.params;
  const userId = req.user._id;
  const isAdmin = req.user.roles?.includes('admin') || false;
  const resolutionNotes = req.body?.resolutionNotes || null;

  if (!mongoose.Types.ObjectId.isValid(chatId)) {
    throw new ApiError(400, "Invalid chat ID");
  }

  const chat = await closeSupportChat(chatId, userId, resolutionNotes);

  await auditLog(userId, "SUPPORT_CHAT_CLOSED", `Closed support chat ${chatId}`, {
    chatId,
    resolutionNotes,
  });

  const populatedChat = await SupportChat.findById(chatId)
    .populate("userId", "name email profileImage")
    .populate("adminId", "name email profileImage")
    .populate("closedBy", "name email");

  return res.status(200).json(
    new ApiResponse(200, populatedChat, "Support chat closed successfully")
  );
});

// Purpose: Retrieves all support chats with filtering options for admin
const getAllSupportChatsAdmin = asyncHandler(async (req, res) => {
  if (!req.user.roles?.includes('admin')) {
    throw new ApiError(403, "Only admins can view all support chats");
  }

  const { status, priority, assignedTo, page = 1, limit = 10 } = req.query;

  const result = await getAllSupportChats({
    status,
    priority,
    assignedTo,
    page,
    limit,
  });

  return res.status(200).json(
    new ApiResponse(200, result, "Support chats retrieved successfully")
  );
});

// Purpose: Assigns an admin to a support chat conversation
const assignAdminToChatHandler = asyncHandler(async (req, res) => {
  if (!req.user.roles?.includes('admin')) {
    throw new ApiError(403, "Only admins can assign chats");
  }

  const { chatId } = req.params;
  const adminId = req.user._id;
  const assignTo = req.body?.assignTo || null;

  if (!mongoose.Types.ObjectId.isValid(chatId)) {
    throw new ApiError(400, "Invalid chat ID");
  }

  const targetAdminId = assignTo || adminId;
  const chat = await assignAdminToChat(chatId, targetAdminId);

  await auditLog(adminId, "SUPPORT_CHAT_ASSIGNED", `Assigned chat ${chatId} to admin`, {
    chatId,
    assignedTo: targetAdminId,
  });

  const populatedChat = await SupportChat.findById(chatId)
    .populate("userId", "name email profileImage")
    .populate("adminId", "name email profileImage");

  return res.status(200).json(
    new ApiResponse(200, populatedChat, "Support chat assigned successfully")
  );
});

// Purpose: Retrieves support chat statistics for admin
const getSupportStats = asyncHandler(async (req, res) => {
  if (!req.user.roles?.includes('admin')) {
    throw new ApiError(403, "Only admins can view support statistics");
  }

  const [open, pending, closed, total, unassigned] = await Promise.all([
    SupportChat.countDocuments({ status: 'open' }),
    SupportChat.countDocuments({ status: 'pending' }),
    SupportChat.countDocuments({ status: 'closed' }),
    SupportChat.countDocuments(),
    SupportChat.countDocuments({ status: 'open', adminId: null }),
  ]);

  return res.status(200).json(
    new ApiResponse(200, {
      open,
      pending,
      closed,
      total,
      unassigned,
    }, "Support statistics retrieved successfully")
  );
});

export {
  createSupportChat,
  getMySupportChats,
  getSupportChatMessages,
  sendSupportMessageHandler,
  closeSupportChatHandler,
  getAllSupportChatsAdmin,
  assignAdminToChatHandler,
  getSupportStats,
};
