import { SupportChat } from '../models/support.model.js';
import { SupportMessage } from '../models/supportMessage.model.js';
import { User } from '../models/user.model.js';
import { ApiError } from '../utils/ApiError.js';
import mongoose from 'mongoose';

// Purpose: Creates a support chat conversation for logged-in or anonymous users
export const createSupportConversation = async (data) => {
  const { userId, guestEmail, guestName, guestSessionId, subject, initialMessage } = data;

  if (!initialMessage) {
    throw new ApiError(400, 'Initial message is required');
  }

  if (!userId && !guestEmail && !guestSessionId) {
    throw new ApiError(400, 'User identification required (userId, guestEmail, or guestSessionId)');
  }

  let existingChat;
  if (userId) {
    existingChat = await SupportChat.findOne({
      userId: new mongoose.Types.ObjectId(userId),
      status: { $in: ['open', 'pending'] },
    });
  } else if (guestSessionId) {
    existingChat = await SupportChat.findOne({
      guestSessionId,
      status: { $in: ['open', 'pending'] },
    });
  } else if (guestEmail) {
    existingChat = await SupportChat.findOne({
      guestEmail,
      userId: null,
      status: { $in: ['open', 'pending'] },
    });
  }

  if (existingChat) {
    return { chat: existingChat, isNew: false };
  }

  const supportChat = await SupportChat.create({
    userId: userId ? new mongoose.Types.ObjectId(userId) : null,
    guestEmail: guestEmail || null,
    guestName: guestName || null,
    guestSessionId: guestSessionId || null,
    subject: subject || 'General Inquiry',
    status: 'open',
    adminId: null,
  });

  const senderType = userId ? 'user' : 'guest';
  const message = await SupportMessage.create({
    supportChatId: supportChat._id,
    senderId: userId ? new mongoose.Types.ObjectId(userId) : null,
    senderName: guestName || null,
    senderEmail: guestEmail || null,
    senderType,
    messageText: initialMessage,
    messageType: 'text',
    isRead: false,
    sentAt: new Date(),
  });

  supportChat.lastMessage = initialMessage;
  supportChat.lastMessageAt = new Date();
  supportChat.unreadCountAdmin = 1;
  await supportChat.save();

  return { chat: supportChat, message, isNew: true };
};

// Purpose: Assigns an admin to a support chat conversation
export const assignAdminToChat = async (chatId, adminId) => {
  const chat = await SupportChat.findById(chatId);
  if (!chat) {
    throw new ApiError(404, 'Support chat not found');
  }

  if (chat.adminId) {
    throw new ApiError(400, 'Chat already assigned to an admin');
  }

  const admin = await User.findById(adminId);
  if (!admin || !admin.roles?.includes('admin')) {
    throw new ApiError(403, 'Invalid admin ID');
  }

  chat.adminId = new mongoose.Types.ObjectId(adminId);
  chat.status = 'pending';
  await chat.save();

  return chat;
};

// Purpose: Retrieves all support chats with optional filtering for admin
export const getAllSupportChats = async (filters = {}) => {
  const { status, priority, assignedTo, page = 1, limit = 20 } = filters;

  const match = {};
  if (status) {
    match.status = status;
  } else {
    match.status = { $in: ['open', 'pending'] };
  }
  if (priority) {
    match.priority = priority;
  }
  if (assignedTo) {
    match.adminId = new mongoose.Types.ObjectId(assignedTo);
  }

  const skip = (page - 1) * limit;

  const chats = await SupportChat.find(match)
    .populate('userId', 'name email profileImage')
    .populate('adminId', 'name email profileImage')
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(parseInt(limit))
    .lean();

  const total = await SupportChat.countDocuments(match);

  return {
    chats,
    pagination: {
      page: parseInt(page),
      limit: parseInt(limit),
      total,
      pages: Math.ceil(total / limit),
    },
  };
};

// Purpose: Retrieves support chat messages with access verification
export const getSupportMessages = async (chatId, userId = null, isAdmin = false) => {
  const chat = await SupportChat.findById(chatId);
  if (!chat) {
    throw new ApiError(404, 'Support chat not found');
  }

  if (!isAdmin) {
    if (chat.userId && chat.userId.toString() !== userId?.toString()) {
      if (!chat.guestSessionId || chat.guestSessionId !== userId) {
        throw new ApiError(403, 'Access denied');
      }
    }
  }

  const messages = await SupportMessage.find({ supportChatId: chatId })
    .populate('senderId', 'name email profileImage')
    .sort({ sentAt: 1 })
    .lean();

  return messages;
};

// Purpose: Sends a message in a support chat conversation
export const sendSupportMessage = async (data) => {
  const { chatId, userId, isAdmin, messageText, messageType = 'text', guestName, guestEmail } = data;

  const chat = await SupportChat.findById(chatId);
  if (!chat) {
    throw new ApiError(404, 'Support chat not found');
  }

  if (chat.status === 'closed') {
    throw new ApiError(400, 'This support chat is closed');
  }

  let senderType;
  let senderId = null;
  let senderNameValue = null;
  let senderEmailValue = null;

  if (isAdmin) {
    senderType = 'admin';
    senderId = new mongoose.Types.ObjectId(userId);
  } else if (chat.userId && chat.userId.toString() === userId?.toString()) {
    senderType = 'user';
    senderId = new mongoose.Types.ObjectId(userId);
  } else {
    senderType = 'guest';
    senderNameValue = guestName || chat.guestName || 'Guest';
    senderEmailValue = guestEmail || chat.guestEmail;
  }

  const message = await SupportMessage.create({
    supportChatId: chatId,
    senderId,
    senderName: senderNameValue,
    senderEmail: senderEmailValue,
    senderType,
    messageText,
    messageType,
    isRead: false,
    sentAt: new Date(),
  });

  chat.lastMessage = messageText;
  chat.lastMessageAt = new Date();
  
  if (isAdmin) {
    chat.unreadCountUser = (chat.unreadCountUser || 0) + 1;
  } else {
    chat.unreadCountAdmin = (chat.unreadCountAdmin || 0) + 1;
  }
  
  await chat.save();

  return message;
};

// Purpose: Marks messages as read in a support chat
export const markMessagesAsRead = async (chatId, userId, isAdmin) => {
  const updateQuery = {
    supportChatId: chatId,
    isRead: false,
  };

  if (isAdmin) {
    updateQuery.senderType = { $ne: 'admin' };
  } else {
    updateQuery.senderType = { $in: ['user', 'guest'] };
  }

  await SupportMessage.updateMany(updateQuery, {
    isRead: true,
    readAt: new Date(),
  });

  const chat = await SupportChat.findById(chatId);
  if (isAdmin) {
    chat.unreadCountAdmin = 0;
    chat.lastReadByAdmin = new Date();
  } else {
    chat.unreadCountUser = 0;
    chat.lastReadByUser = new Date();
  }
  await chat.save();
};

// Purpose: Closes a support chat conversation with optional resolution notes
export const closeSupportChat = async (chatId, userId, resolutionNotes = null) => {
  const chat = await SupportChat.findById(chatId);
  if (!chat) {
    throw new ApiError(404, 'Support chat not found');
  }

  chat.status = 'closed';
  chat.closedAt = new Date();
  chat.closedBy = new mongoose.Types.ObjectId(userId);
  if (resolutionNotes) {
    chat.resolutionNotes = resolutionNotes;
    chat.resolvedAt = new Date();
  }
  await chat.save();

  return chat;
};

