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
import { uploadChatImageFromBuffer } from "../utils/cloudinary.js";

const createConversation = asyncHandler(async (req, res) => {
  const buyerId = req.user._id;
  const { sellerId, orderId, productId } = req.body;

  if (!sellerId) {
    throw new ApiError(400, "Seller ID is required");
  }

  const seller = await Seller.findById(sellerId);
  if (!seller) {
    throw new ApiError(404, "Seller not found");
  }

  if (orderId) {
    const order = await Order.findOne({
      _id: orderId,
      userId: buyerId,
    });

    if (!order) {
      throw new ApiError(404, "Order not found or you don't have access");
    }
  }

  let existingConversation;
  
  if (orderId) {
    existingConversation = await Conversation.findOne({
      buyerId,
      sellerId,
      orderId,
    });
  } else {
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

const getConversations = asyncHandler(async (req, res) => {
  const userId = req.user._id;
  const { role } = req.query;

  let match = {};

  if (role === "seller") {
    const seller = await Seller.findOne({ userId });
    if (!seller) {
      throw new ApiError(404, "Seller account not found");
    }
    match.sellerId = seller._id;
  } else {
    match.buyerId = userId;
  }

  const conversationsQuery = Conversation.find(match)
    .populate("buyerId", "name email profileImage")
    .populate("sellerId", "shopName shopLogo")
    .populate("orderId", "totalAmount orderStatus")
    .populate("productId", "name slug images")
    .sort({ lastMessageAt: -1, createdAt: -1 })
    .lean()
    .maxTimeMS(5000);
  
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

const getMessages = asyncHandler(async (req, res) => {
  const { conversationId } = req.params;
  const userId = req.user._id;
  const { cursor, limit: limitParam } = req.query;

  if (!mongoose.Types.ObjectId.isValid(conversationId)) {
    throw new ApiError(400, "Invalid conversation ID");
  }

  const [conversation, seller] = await Promise.all([
    Conversation.findById(conversationId).select('buyerId sellerId').lean(),
    Seller.findOne({ userId }).select('_id').lean()
  ]);

  if (!conversation) {
    throw new ApiError(404, "Conversation not found");
  }

  const isBuyer = conversation.buyerId.toString() === userId.toString();
  const isSeller = seller && conversation.sellerId.toString() === seller._id.toString();

  if (!isBuyer && !isSeller) {
    throw new ApiError(403, "You don't have access to this conversation");
  }

  const messageLimit = Math.min(Math.max(parseInt(limitParam) || 20, 1), 50);
  
  let query = { 
    conversationId: new mongoose.Types.ObjectId(conversationId),
    isDeleted: { $ne: true }
  };
  
  if (cursor && !isNaN(new Date(cursor).getTime())) {
    query.sentAt = { $lt: new Date(cursor) };
  }
  
  const messagesQuery = Message.find(query)
    .select("_id conversationId senderId receiverId messageText messageType attachment uploadStatus isRead sentAt")
    .sort({ sentAt: -1 })
    .limit(messageLimit + 1)
    .lean()
    .maxTimeMS(5000)
    .hint({ conversationId: 1, sentAt: -1 });
  
  let messages = await messagesQuery;
  
  const hasMore = messages.length > messageLimit;
  if (hasMore) {
    messages = messages.slice(0, messageLimit);
  }
  
  const senderIds = [...new Set(messages.map(m => m.senderId?.toString()).filter(Boolean))];
  const receiverIds = [...new Set(messages.map(m => m.receiverId?.toString()).filter(Boolean))];
  const userIds = [...new Set([...senderIds, ...receiverIds])];
  
  if (messages.length > 0 && userIds.length > 0) {
    const users = await User.find({ 
      _id: { $in: userIds.map(id => new mongoose.Types.ObjectId(id)) } 
    })
      .select("_id name profileImage")
      .lean()
      .maxTimeMS(3000)
      .hint({ _id: 1 });
    
    const userMap = new Map(users.map(u => [u._id.toString(), u]));
    
    messages = messages.map(msg => {
      const senderIdStr = msg.senderId?.toString();
      const receiverIdStr = msg.receiverId?.toString();
      return {
        ...msg,
        senderId: userMap.get(senderIdStr) || { _id: msg.senderId, name: 'Unknown', profileImage: null },
        receiverId: userMap.get(receiverIdStr) || { _id: msg.receiverId, name: 'Unknown', profileImage: null },
      };
    });
  }
  
  const nextCursor = messages.length > 0 ? messages[messages.length - 1].sentAt : null;
  
  if (isBuyer) {
    Message.updateMany(
      { conversationId, receiverId: userId, isRead: false },
      { isRead: true }
    ).catch(() => {});
    
    Conversation.findByIdAndUpdate(conversationId, {
      unreadCountBuyer: 0,
      lastReadByBuyer: new Date()
    }).catch(() => {});
  } else if (isSeller) {
    Message.updateMany(
      { conversationId, receiverId: userId, isRead: false },
      { isRead: true }
    ).catch(() => {});
    
    Conversation.findByIdAndUpdate(conversationId, {
      unreadCountSeller: 0,
      lastReadBySeller: new Date()
    }).catch(() => {});
  }

  return res.status(200).json(
    new ApiResponse(200, {
      messages: messages.reverse(),
      nextCursor: nextCursor ? nextCursor.toISOString() : null,
      hasMore,
    }, "Messages retrieved successfully")
  );
});

const sendMessage = asyncHandler(async (req, res) => {
  const { conversationId, messageText, messageType = "text", attachment = null } = req.body;
  const senderId = req.user._id;

  if (!conversationId || !messageText) {
    throw new ApiError(400, "Conversation ID and message text are required");
  }

  const conversation = await Conversation.findById(conversationId);
  if (!conversation) {
    throw new ApiError(404, "Conversation not found");
  }

  const seller = await Seller.findOne({ userId: senderId });
  let receiverId;

        if (conversation.buyerId.toString() === senderId.toString()) {
          const seller = await Seller.findById(conversation.sellerId);
          if (!seller) {
            throw new ApiError(404, "Seller not found");
          }
          receiverId = seller.userId;
    conversation.unreadCountSeller = (conversation.unreadCountSeller || 0) + 1;
  } else if (seller && conversation.sellerId.toString() === seller._id.toString()) {
    receiverId = conversation.buyerId;
    conversation.unreadCountBuyer = (conversation.unreadCountBuyer || 0) + 1;
  } else {
    throw new ApiError(403, "You don't have access to this conversation");
  }

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

  conversation.lastMessage = messageText;
  conversation.lastMessageAt = new Date();
  await conversation.save();

  const populatedMessage = await Message.findById(message._id)
    .populate("senderId", "name email profileImage")
    .populate("receiverId", "name email profileImage");

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
    `/user/chat?conversation=${conversationId}`,
    'high'
  ).catch((err) => {
  });

  if (req.app.get('io')) {
    const io = req.app.get('io');
    
    io.to(`conversation:${conversationId}`).emit('new_message', populatedMessage);
    
    io.to(`user:${receiverId}`).emit('message_received', {
      conversationId,
      message: populatedMessage,
    });

    io.to(`user:${receiverId}`).emit('notification_new', {
      type: 'chat',
      conversationId: conversationId.toString(),
    });
  }

  return res.status(201).json(
    new ApiResponse(201, populatedMessage, "Message sent successfully")
  );
});

const sendImageMessage = asyncHandler(async (req, res) => {
  const { conversationId, messageText = '' } = req.body;
  const senderId = req.user._id;
  const imageFile = req.file;

  if (!conversationId || !imageFile?.buffer) {
    throw new ApiError(400, "Conversation ID and image file are required");
  }

  const conversation = await Conversation.findById(conversationId);
  if (!conversation) {
    throw new ApiError(404, "Conversation not found");
  }

  const seller = await Seller.findOne({ userId: senderId });
  let receiverId;

  if (conversation.buyerId.toString() === senderId.toString()) {
    const sellerRecord = await Seller.findById(conversation.sellerId);
    if (!sellerRecord) {
      throw new ApiError(404, "Seller not found");
    }
    receiverId = sellerRecord.userId;
    conversation.unreadCountSeller = (conversation.unreadCountSeller || 0) + 1;
  } else if (seller && conversation.sellerId.toString() === seller._id.toString()) {
    receiverId = conversation.buyerId;
    conversation.unreadCountBuyer = (conversation.unreadCountBuyer || 0) + 1;
  } else {
    throw new ApiError(403, "You don't have access to this conversation");
  }

  const message = await Message.create({
    conversationId,
    senderId,
    receiverId,
    messageText: messageText.trim() || 'Image',
    messageType: 'image',
    uploadStatus: 'pending',
    isRead: false,
    sentAt: new Date(),
  });

  conversation.lastMessage = messageText.trim() || 'Image';
  conversation.lastMessageAt = new Date();
  await conversation.save();

  const populatedMessage = await Message.findById(message._id)
    .populate("senderId", "name email profileImage")
    .populate("receiverId", "name email profileImage");

  const senderName = populatedMessage.senderId?.name || populatedMessage.senderId?.username || 'Someone';
  const messagePreview = (messageText.trim() || 'Image').length > 50 
    ? (messageText.trim() || 'Image').substring(0, 50) + '...' 
    : (messageText.trim() || 'Image');

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
    `/user/chat?conversation=${conversationId}`,
    'high'
  ).catch(() => {});

  if (req.app.get('io')) {
    const io = req.app.get('io');
    io.to(`conversation:${conversationId}`).emit('new_message', populatedMessage);
    io.to(`user:${receiverId}`).emit('message_received', {
      conversationId,
      message: populatedMessage,
    });
    io.to(`user:${receiverId}`).emit('notification_new', {
      type: 'chat',
      conversationId: conversationId.toString(),
    });
  }

  res.status(201).json(
    new ApiResponse(201, populatedMessage, "Message sent successfully")
  );

  setImmediate(async () => {
    try {
      const result = await uploadChatImageFromBuffer(imageFile.buffer);
      const updated = await Message.findByIdAndUpdate(
        message._id,
        {
          attachment: result.url,
          uploadStatus: 'completed',
          attachmentMetadata: {
            publicId: result.publicId,
            width: result.width,
            height: result.height,
          },
        },
        { new: true }
      )
        .populate("senderId", "name email profileImage")
        .populate("receiverId", "name email profileImage");

      if (req.app.get('io') && updated) {
        const io = req.app.get('io');
        io.to(`conversation:${conversationId}`).emit('message_updated', updated);
        io.to(`user:${receiverId}`).emit('message_updated', updated);
      }
    } catch (err) {
      const failedMsg = await Message.findByIdAndUpdate(
        message._id,
        { uploadStatus: 'failed' },
        { new: true }
      )
        .populate("senderId", "name email profileImage")
        .populate("receiverId", "name email profileImage");
      if (req.app.get('io') && failedMsg) {
        const io = req.app.get('io');
        const payload = failedMsg.toObject ? failedMsg.toObject() : failedMsg;
        io.to(`conversation:${conversationId}`).emit('message_updated', payload);
        io.to(`user:${receiverId}`).emit('message_updated', payload);
      }
    }
  });
});

const markAsRead = asyncHandler(async (req, res) => {
  const { conversationId } = req.params;
  const userId = req.user._id;

  const [conversation, seller] = await Promise.all([
    Conversation.findById(conversationId).lean(),
    Seller.findOne({ userId }).lean()
  ]);

  if (!conversation) {
    throw new ApiError(404, "Conversation not found");
  }

  const isBuyer = conversation.buyerId.toString() === userId.toString();
  const isSeller = seller && conversation.sellerId.toString() === seller._id.toString();

  if (!isBuyer && !isSeller) {
    throw new ApiError(403, "You don't have access to this conversation");
  }

  res.status(200).json(
    new ApiResponse(200, null, "Messages marked as read")
  );

  Message.updateMany(
    { 
      conversationId: new mongoose.Types.ObjectId(conversationId), 
      receiverId: userId, 
      isRead: false 
    },
    { isRead: true }
  )
    .maxTimeMS(5000)
    .hint({ conversationId: 1, receiverId: 1, isRead: 1 })
    .exec()
    .catch(() => {});

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

  if (isBuyer) {
    conversation.archivedByBuyer = true;
  } else {
    conversation.archivedBySeller = true;
  }

  if (conversation.archivedByBuyer && conversation.archivedBySeller) {
    conversation.status = "closed";
  }

  await conversation.save();

  return res.status(200).json(
    new ApiResponse(200, conversation, "Conversation archived successfully")
  );
});

const getUnreadCount = asyncHandler(async (req, res) => {
  const userId = req.user._id;
  const seller = await Seller.findOne({ userId }).lean();

  let totalUnread = 0;

  if (seller) {
    const result = await Conversation.aggregate([
      { $match: { sellerId: seller._id } },
      { $group: { _id: null, total: { $sum: { $ifNull: ["$unreadCountSeller", 0] } } } }
    ]);
    totalUnread = result[0]?.total || 0;
  } else {
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
  sendImageMessage,
  markAsRead,
  deleteConversation,
  getUnreadCount,
};

