import mongoose from "mongoose";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { Conversation } from "../models/conversation.model.js";
import { Message } from "../models/message.model.js";
import { Order } from "../models/order.model.js";
import { Seller } from "../models/seller.model.js";
import { User } from "../models/user.model.js";

/**
 * Create conversation (with or without order)
 */
const createConversation = asyncHandler(async (req, res) => {
  const buyerId = req.user._id;
  const { sellerId, orderId, productId } = req.body;

  if (!sellerId) {
    throw new ApiError(400, "Seller ID is required");
  }

  // Verify seller exists
  const seller = await Seller.findById(sellerId);
  if (!seller) {
    throw new ApiError(404, "Seller not found");
  }

  // If orderId is provided, verify order exists and belongs to buyer
  if (orderId) {
    const order = await Order.findOne({
      _id: orderId,
      userId: buyerId,
    });

    if (!order) {
      throw new ApiError(404, "Order not found or you don't have access");
    }
  }

  // Check if conversation already exists
  let existingConversation;
  
  if (orderId) {
    // Check for conversation with this orderId
    existingConversation = await Conversation.findOne({
      buyerId,
      sellerId,
      orderId,
    });
  } else {
    // For conversations without order, check if there's an existing active conversation without orderId
    existingConversation = await Conversation.findOne({
      buyerId,
      sellerId,
      $or: [
        { orderId: { $exists: false } },
        { orderId: null },
      ],
    });
  }

  if (existingConversation) {
    const populated = await Conversation.findById(existingConversation._id)
      .populate("buyerId", "name email profileImage")
      .populate("sellerId", "shopName shopLogo")
      .populate("orderId", "totalAmount orderStatus")
      .populate("productId", "name slug images");
    
    return res.status(200).json(
      new ApiResponse(200, populated, "Conversation already exists")
    );
  }

  // Create conversation
  const conversationData = {
    buyerId,
    sellerId,
    status: "active",
  };

  if (orderId) {
    conversationData.orderId = orderId;
  }

  if (productId) {
    conversationData.productId = productId;
  }

  const conversation = await Conversation.create(conversationData);

  const populatedConversation = await Conversation.findById(conversation._id)
    .populate("buyerId", "name email profileImage")
    .populate("sellerId", "shopName shopLogo")
    .populate("orderId", "totalAmount orderStatus")
    .populate("productId", "name slug images");

  return res.status(201).json(
    new ApiResponse(201, populatedConversation, "Conversation created successfully")
  );
});

/**
 * Get user conversations
 */
const getConversations = asyncHandler(async (req, res) => {
  const userId = req.user._id;
  const { role } = req.query; // 'buyer' or 'seller'

  let match = {};

  if (role === "seller") {
    // Get seller record
    const seller = await Seller.findOne({ userId });
    if (!seller) {
      throw new ApiError(404, "Seller account not found");
    }
    match.sellerId = seller._id;
  } else {
    match.buyerId = userId;
  }

  // Optimize: Use lean() for faster queries, limit populated fields
  const conversations = await Conversation.find(match)
    .populate("buyerId", "name email profileImage")
    .populate("sellerId", "shopName shopLogo")
    .populate("orderId", "totalAmount orderStatus")
    .populate("productId", "name slug images")
    .sort({ lastMessageAt: -1, createdAt: -1 })
    .lean(); // Use lean() for 2-3x faster queries

  return res.status(200).json(
    new ApiResponse(200, conversations, "Conversations retrieved successfully")
  );
});

/**
 * Get messages for a conversation
 */
const getMessages = asyncHandler(async (req, res) => {
  const { conversationId } = req.params;
  const userId = req.user._id;
  const { page = 1, limit = 25 } = req.query; // Reduced default from 50 to 25 for better performance

  if (!mongoose.Types.ObjectId.isValid(conversationId)) {
    throw new ApiError(400, "Invalid conversation ID");
  }

  // Parallelize: Fetch conversation and seller lookup simultaneously
  const [conversation, seller] = await Promise.all([
    Conversation.findById(conversationId).lean(), // Use lean() for faster lookup
    Seller.findOne({ userId }).lean() // Use lean() for faster lookup
  ]);

  if (!conversation) {
    throw new ApiError(404, "Conversation not found");
  }

  // Check if user is buyer or seller
  const isBuyer = conversation.buyerId.toString() === userId.toString();
  const isSeller = seller && conversation.sellerId.toString() === seller._id.toString();

  if (!isBuyer && !isSeller) {
    throw new ApiError(403, "You don't have access to this conversation");
  }

  // Get messages with optimized query
  // Default to 25 messages for initial load (better performance)
  const messageLimit = Math.min(parseInt(limit) || 25, 50); // Cap at 50
  const skip = (parseInt(page) - 1) * messageLimit;
  
  // Use lean() for better performance (returns plain JS objects instead of Mongoose documents)
  // Only populate essential fields
  const messages = await Message.find({ conversationId })
    .populate("senderId", "name email profileImage")
    .populate("receiverId", "name email profileImage")
    .sort({ sentAt: -1 }) // Latest messages first (will be reversed to show oldest first)
    .skip(skip)
    .limit(messageLimit)
    .lean(); // Use lean() for 2-3x faster queries

  // CRITICAL PERFORMANCE FIX: Return response immediately, don't wait for slow operations
  // countDocuments can take 30+ seconds on large collections - DON'T WAIT FOR IT
  // Mark as read operations can also be slow - do them in background
  
  // Start background operations (don't await - let them run async)
  if (isBuyer) {
    // Fire and forget - don't block response
    Message.updateMany(
      { conversationId, receiverId: userId, isRead: false },
      { isRead: true }
    ).catch(() => {}); // Ignore errors in background operation
    
    Conversation.findByIdAndUpdate(conversationId, {
      unreadCountBuyer: 0,
      lastReadByBuyer: new Date()
    }).catch(() => {}); // Ignore errors in background operation
  } else if (isSeller) {
    // Fire and forget - don't block response
    Message.updateMany(
      { conversationId, receiverId: userId, isRead: false },
      { isRead: true }
    ).catch(() => {}); // Ignore errors in background operation
    
    Conversation.findByIdAndUpdate(conversationId, {
      unreadCountSeller: 0,
      lastReadBySeller: new Date()
    }).catch(() => {}); // Ignore errors in background operation
  }
  
  // Estimate total instead of counting (much faster)
  // If we got a full page, there are likely more messages
  const hasMore = messages.length === messageLimit;
  const estimatedTotal = hasMore ? (skip + messages.length + 1) : (skip + messages.length);

  // Return response immediately - don't wait for slow operations
  return res.status(200).json(
    new ApiResponse(200, {
      messages: messages.reverse(), // Reverse to show oldest first
      pagination: {
        page: parseInt(page),
        limit: messageLimit,
        total: estimatedTotal, // Estimated total (much faster than countDocuments)
        pages: Math.ceil(estimatedTotal / messageLimit),
        hasMore: hasMore, // Indicate if more pages exist
      },
    }, "Messages retrieved successfully")
  );
});

/**
 * Send message (REST endpoint - Socket.IO will also handle this)
 */
const sendMessage = asyncHandler(async (req, res) => {
  const { conversationId, messageText, messageType = "text", attachment = null } = req.body;
  const senderId = req.user._id;

  if (!conversationId || !messageText) {
    throw new ApiError(400, "Conversation ID and message text are required");
  }

  // Verify conversation exists and user has access
  const conversation = await Conversation.findById(conversationId);
  if (!conversation) {
    throw new ApiError(404, "Conversation not found");
  }

  // Determine receiver
  const seller = await Seller.findOne({ userId: senderId });
  let receiverId;

        if (conversation.buyerId.toString() === senderId.toString()) {
          // Buyer sending to seller - get seller's user ID
          const seller = await Seller.findById(conversation.sellerId);
          if (!seller) {
            throw new ApiError(404, "Seller not found");
          }
          receiverId = seller.userId;
    conversation.unreadCountSeller = (conversation.unreadCountSeller || 0) + 1;
  } else if (seller && conversation.sellerId.toString() === seller._id.toString()) {
    // Seller sending to buyer
    receiverId = conversation.buyerId;
    conversation.unreadCountBuyer = (conversation.unreadCountBuyer || 0) + 1;
  } else {
    throw new ApiError(403, "You don't have access to this conversation");
  }

  // Create message
  const message = await Message.create({
    conversationId,
    senderId,
    receiverId,
    messageText,
    messageType,
    attachment,
    isRead: false,
    sentAt: new Date(),
  });

  // Update conversation
  conversation.lastMessage = messageText;
  conversation.lastMessageAt = new Date();
  await conversation.save();

  const populatedMessage = await Message.findById(message._id)
    .populate("senderId", "name email profileImage")
    .populate("receiverId", "name email profileImage");

  return res.status(201).json(
    new ApiResponse(201, populatedMessage, "Message sent successfully")
  );
});

/**
 * Mark messages as read
 */
const markAsRead = asyncHandler(async (req, res) => {
  const { conversationId } = req.params;
  const userId = req.user._id;

  const conversation = await Conversation.findById(conversationId);
  if (!conversation) {
    throw new ApiError(404, "Conversation not found");
  }

  // Mark messages as read
  await Message.updateMany(
    { conversationId, receiverId: userId, isRead: false },
    { isRead: true }
  );

  // Update conversation unread count
  const seller = await Seller.findOne({ userId });
  if (conversation.buyerId.toString() === userId.toString()) {
    conversation.unreadCountBuyer = 0;
    conversation.lastReadByBuyer = new Date();
  } else if (seller && conversation.sellerId.toString() === seller._id.toString()) {
    conversation.unreadCountSeller = 0;
    conversation.lastReadBySeller = new Date();
  }
  await conversation.save();

  return res.status(200).json(
    new ApiResponse(200, null, "Messages marked as read")
  );
});

/**
 * Delete/archive conversation
 */
const deleteConversation = asyncHandler(async (req, res) => {
  const { conversationId } = req.params;
  const userId = req.user._id;

  const conversation = await Conversation.findById(conversationId);
  if (!conversation) {
    throw new ApiError(404, "Conversation not found");
  }

  const seller = await Seller.findOne({ userId });
  const isBuyer = conversation.buyerId.toString() === userId.toString();
  const isSeller = seller && conversation.sellerId.toString() === seller._id.toString();

  if (!isBuyer && !isSeller) {
    throw new ApiError(403, "You don't have access to this conversation");
  }

  // Archive instead of delete
  if (isBuyer) {
    conversation.archivedByBuyer = true;
  } else {
    conversation.archivedBySeller = true;
  }

  // If both archived, mark as closed
  if (conversation.archivedByBuyer && conversation.archivedBySeller) {
    conversation.status = "closed";
  }

  await conversation.save();

  return res.status(200).json(
    new ApiResponse(200, conversation, "Conversation archived successfully")
  );
});

/**
 * Get unread message count
 */
const getUnreadCount = asyncHandler(async (req, res) => {
  const userId = req.user._id;
  const seller = await Seller.findOne({ userId });

  let totalUnread = 0;

  if (seller) {
    // Seller: count unread messages in conversations
    const conversations = await Conversation.find({ sellerId: seller._id });
    totalUnread = conversations.reduce((sum, conv) => sum + (conv.unreadCountSeller || 0), 0);
  } else {
    // Buyer: count unread messages in conversations
    const conversations = await Conversation.find({ buyerId: userId });
    totalUnread = conversations.reduce((sum, conv) => sum + (conv.unreadCountBuyer || 0), 0);
  }

  return res.status(200).json(
    new ApiResponse(200, { unreadCount: totalUnread }, "Unread count retrieved")
  );
});

export {
  createConversation,
  getConversations,
  getMessages,
  sendMessage,
  markAsRead,
  deleteConversation,
  getUnreadCount,
};

