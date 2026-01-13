import mongoose from "mongoose";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { Conversation } from "../models/conversation.model.js";
import { Message } from "../models/message.model.js";
import { Order } from "../models/order.model.js";
import { Seller } from "../models/seller.model.js";
import { User } from "../models/user.model.js";
import { createNotification } from "../services/notification.service.js";

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
  // Use hint to ensure index usage for better performance
  const conversationsQuery = Conversation.find(match)
    .populate("buyerId", "name email profileImage")
    .populate("sellerId", "shopName shopLogo")
    .populate("orderId", "totalAmount orderStatus")
    .populate("productId", "name slug images")
    .sort({ lastMessageAt: -1, createdAt: -1 })
    .lean() // Use lean() for 2-3x faster queries
    .maxTimeMS(5000); // Max 5 seconds for conversation list
  
  // Add index hint based on match criteria
  if (match.buyerId) {
    conversationsQuery.hint({ buyerId: 1, lastMessageAt: -1 });
  } else if (match.sellerId) {
    conversationsQuery.hint({ sellerId: 1, lastMessageAt: -1 });
  }
  
  const conversations = await conversationsQuery;

  return res.status(200).json(
    new ApiResponse(200, conversations, "Conversations retrieved successfully")
  );
});

/**
 * Get messages for a conversation
 * OPTIMIZED: Uses cursor-based pagination for better performance on large datasets
 * Initial load: 15 messages (reduced from 25 for faster load time)
 */
const getMessages = asyncHandler(async (req, res) => {
  const { conversationId } = req.params;
  const userId = req.user._id;
  const { page = 1, limit = 15, cursor } = req.query; // Reduced default to 15 for faster initial load

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

  // Optimize message limit: 15 for initial load, max 30 for pagination
  const messageLimit = Math.min(parseInt(limit) || 15, 30);
  
  // Build query with cursor-based pagination for better performance
  let query = { 
    conversationId: new mongoose.Types.ObjectId(conversationId),
    isDeleted: { $ne: true }
  };
  
  // Cursor-based pagination: if cursor provided, fetch messages before that timestamp
  if (cursor && !isNaN(new Date(cursor).getTime())) {
    query.sentAt = { $lt: new Date(cursor) };
  }
  
  // OPTIMIZED: Query using compound index {conversationId: 1, sentAt: -1}
  const messagesQuery = Message.find(query)
    .select("conversationId senderId receiverId messageText messageType attachment isRead sentAt createdAt")
    .sort({ sentAt: -1 }) // Uses compound index {conversationId: 1, sentAt: -1}
    .limit(messageLimit + 1) // Fetch one extra to check if there are more
    .lean() // Use lean() for faster query
    .maxTimeMS(5000) // Reduced timeout for faster failure
    .hint({ conversationId: 1, sentAt: -1 }); // Use hint to ensure index usage
  
  // Execute query
  let messages = await messagesQuery;
  
  // Check if there are more messages
  const hasMore = messages.length > messageLimit;
  if (hasMore) {
    messages = messages.slice(0, messageLimit); // Remove the extra message
  }
  
  // Populate senderId and receiverId AFTER lean() for better performance
  const senderIds = [...new Set(messages.map(m => m.senderId?.toString()).filter(Boolean))];
  const receiverIds = [...new Set(messages.map(m => m.receiverId?.toString()).filter(Boolean))];
  const userIds = [...new Set([...senderIds, ...receiverIds])];
  
  // Fetch user data in parallel ONLY if we have messages (optimized)
  if (messages.length > 0 && userIds.length > 0) {
    // Use find() with $in - MongoDB optimizes this efficiently with indexes
    const users = await User.find({ 
      _id: { $in: userIds.map(id => new mongoose.Types.ObjectId(id)) } 
    })
      .select("name email profileImage")
      .lean()
      .maxTimeMS(3000) // Reduced timeout
      .hint({ _id: 1 }); // Explicitly use _id index
    
    // Create user lookup map for O(1) access
    const userMap = new Map(users.map(u => [u._id.toString(), u]));
    
    // Attach user data to messages
    messages = messages.map(msg => {
      const senderIdStr = msg.senderId?.toString();
      const receiverIdStr = msg.receiverId?.toString();
      
      return {
        ...msg,
        senderId: userMap.get(senderIdStr) || { _id: msg.senderId, name: 'Unknown', email: null, profileImage: null },
        receiverId: userMap.get(receiverIdStr) || { _id: msg.receiverId, name: 'Unknown', email: null, profileImage: null },
      };
    });
  }
  
  // Get oldest message timestamp for next cursor
  const nextCursor = messages.length > 0 ? messages[messages.length - 1].sentAt : null;
  
  // CRITICAL PERFORMANCE FIX: Mark as read in background (don't block response)
  if (isBuyer) {
    Message.updateMany(
      { conversationId, receiverId: userId, isRead: false },
      { isRead: true }
    ).catch(() => {}); // Ignore errors in background operation
    
    Conversation.findByIdAndUpdate(conversationId, {
      unreadCountBuyer: 0,
      lastReadByBuyer: new Date()
    }).catch(() => {}); // Ignore errors in background operation
  } else if (isSeller) {
    Message.updateMany(
      { conversationId, receiverId: userId, isRead: false },
      { isRead: true }
    ).catch(() => {}); // Ignore errors in background operation
    
    Conversation.findByIdAndUpdate(conversationId, {
      unreadCountSeller: 0,
      lastReadBySeller: new Date()
    }).catch(() => {}); // Ignore errors in background operation
  }

  // Return response immediately with cursor-based pagination
  return res.status(200).json(
    new ApiResponse(200, {
      messages: messages.reverse(), // Reverse to show oldest first
      pagination: {
        page: parseInt(page),
        limit: messageLimit,
        hasMore: hasMore,
        nextCursor: nextCursor ? nextCursor.toISOString() : null, // Cursor for next page
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

  // Create notification in database (non-blocking)
  const senderName = populatedMessage.senderId?.name || populatedMessage.senderId?.username || 'Someone';
  const messagePreview = messageText.length > 50 ? messageText.substring(0, 50) + '...' : messageText;
  
  createNotification(
    receiverId,
    'chat',
    `New message from ${senderName}`,
    messagePreview,
    {
      messageId: message._id.toString(),
      conversationId: conversationId.toString(),
      senderId: senderId.toString(),
      senderName: senderName,
      senderAvatar: populatedMessage.senderId?.profileImage || null,
    },
    `/user/chat?conversation=${conversationId}`, // Default route, frontend will adjust based on role
    'high'
  ).catch((err) => {
    // Log error but don't block message sending
    // Notification creation failure shouldn't prevent message delivery
  });

  // Emit socket event for real-time delivery
  if (req.app.get('io')) {
    const io = req.app.get('io');
    
    // Emit to conversation room
    io.to(`conversation:${conversationId}`).emit('new_message', populatedMessage);
    
    // Emit to receiver's personal room (for notifications)
    io.to(`user:${receiverId}`).emit('message_received', {
      conversationId,
      message: populatedMessage,
    });

    // Emit notification update to receiver
    io.to(`user:${receiverId}`).emit('notification_new', {
      type: 'chat',
      conversationId: conversationId.toString(),
    });
  }

  return res.status(201).json(
    new ApiResponse(201, populatedMessage, "Message sent successfully")
  );
});

/**
 * Mark messages as read
 * OPTIMIZED: Fast response, background updates for large batches
 */
const markAsRead = asyncHandler(async (req, res) => {
  const { conversationId } = req.params;
  const userId = req.user._id;

  // Parallel queries for faster response
  const [conversation, seller] = await Promise.all([
    Conversation.findById(conversationId).lean(),
    Seller.findOne({ userId }).lean()
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

  // Return response immediately - don't wait for slow updateMany operations
  // This prevents timeouts on conversations with many unread messages
  res.status(200).json(
    new ApiResponse(200, null, "Messages marked as read")
  );

  // Perform updates in background (non-blocking)
  // Use updateMany with timeout to prevent hanging
  Message.updateMany(
    { 
      conversationId: new mongoose.Types.ObjectId(conversationId), 
      receiverId: userId, 
      isRead: false 
    },
    { isRead: true }
  )
    .maxTimeMS(5000) // 5 second timeout
    .hint({ conversationId: 1, receiverId: 1, isRead: 1 }) // Use compound index
    .exec()
    .catch(() => {}); // Ignore errors in background

  // Update conversation unread count in background
  if (isBuyer) {
    Conversation.findByIdAndUpdate(conversationId, {
      unreadCountBuyer: 0,
      lastReadByBuyer: new Date()
    }).catch(() => {});
  } else if (isSeller) {
    Conversation.findByIdAndUpdate(conversationId, {
      unreadCountSeller: 0,
      lastReadBySeller: new Date()
    }).catch(() => {});
  }
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
 * OPTIMIZED: Uses aggregation pipeline instead of loading all conversations
 */
const getUnreadCount = asyncHandler(async (req, res) => {
  const userId = req.user._id;
  const seller = await Seller.findOne({ userId }).lean();

  let totalUnread = 0;

  if (seller) {
    // Seller: aggregate unread counts using MongoDB aggregation (much faster)
    const result = await Conversation.aggregate([
      { $match: { sellerId: seller._id } },
      { $group: { _id: null, total: { $sum: { $ifNull: ["$unreadCountSeller", 0] } } } }
    ]);
    totalUnread = result[0]?.total || 0;
  } else {
    // Buyer: aggregate unread counts using MongoDB aggregation (much faster)
    const result = await Conversation.aggregate([
      { $match: { buyerId: userId } },
      { $group: { _id: null, total: { $sum: { $ifNull: ["$unreadCountBuyer", 0] } } } }
    ]);
    totalUnread = result[0]?.total || 0;
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

