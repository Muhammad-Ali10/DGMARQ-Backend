import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import { User } from '../models/user.model.js';
import { Message } from '../models/message.model.js';
import { Conversation } from '../models/conversation.model.js';
import { SupportChat } from '../models/support.model.js';
import { SupportMessage } from '../models/supportMessage.model.js';
import { Seller } from '../models/seller.model.js';
import { sendSupportMessage, markMessagesAsRead } from '../services/support.service.js';

/**
 * Initialize Socket.IO server
 */
export const initializeSocketIO = (server) => {
  const io = new Server(server, {
    cors: {
      origin: ["*"],
      credentials: true,
    },
  });

  // Authentication middleware for Socket.IO
  io.use(async (socket, next) => {
      try {
        const token = socket.handshake.auth.token || socket.handshake.headers.authorization?.split(' ')[1];
        
        if (!token) {
          return next(new Error('Authentication error: No token provided'));
        }

        const decoded = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET);
        const user = await User.findById(decoded._id).select('-password -refreshToken');
        
        if (!user) {
          return next(new Error('Authentication error: User not found'));
        }

        socket.userId = user._id;
        socket.user = user;
        next();
      } catch (error) {
        next(new Error('Authentication error: Invalid token'));
      }
  });

  io.on('connection', (socket) => {
    console.log(`User connected: ${socket.userId}`);

    // Join user's personal room
    socket.join(`user:${socket.userId}`);

    // Join conversation room
    socket.on('join_conversation', async (conversationId) => {
      try {
        // Verify user has access to this conversation
        const conversation = await Conversation.findById(conversationId);
        if (!conversation) {
          socket.emit('error', { message: 'Conversation not found' });
          return;
        }

        const seller = await Seller.findOne({ userId: socket.userId });
        const isBuyer = conversation.buyerId.toString() === socket.userId.toString();
        const isSeller = seller && conversation.sellerId.toString() === seller._id.toString();

        if (!isBuyer && !isSeller) {
          socket.emit('error', { message: 'Access denied' });
          return;
        }

        socket.join(`conversation:${conversationId}`);
        socket.emit('joined_conversation', { conversationId });
      } catch (error) {
        socket.emit('error', { message: error.message });
      }
    });

    // Leave conversation room
    socket.on('leave_conversation', (conversationId) => {
      socket.leave(`conversation:${conversationId}`);
    });

    // Send message
    socket.on('send_message', async (data) => {
      try {
        const { conversationId, messageText, messageType = 'text', attachment = null } = data;

        if (!conversationId || !messageText) {
          socket.emit('error', { message: 'Conversation ID and message text are required' });
          return;
        }

        // Verify conversation exists
        const conversation = await Conversation.findById(conversationId);
        if (!conversation) {
          socket.emit('error', { message: 'Conversation not found' });
          return;
        }

        // Determine receiver
        const seller = await Seller.findOne({ userId: socket.userId });
        let receiverId;

        if (conversation.buyerId.toString() === socket.userId.toString()) {
          // Buyer sending to seller - get seller's user ID
          const sellerRecord = await Seller.findById(conversation.sellerId);
          if (!sellerRecord) {
            socket.emit('error', { message: 'Seller not found' });
            return;
          }
          receiverId = sellerRecord.userId;
          conversation.unreadCountSeller = (conversation.unreadCountSeller || 0) + 1;
        } else if (seller && conversation.sellerId.toString() === seller._id.toString()) {
          receiverId = conversation.buyerId;
          conversation.unreadCountBuyer = (conversation.unreadCountBuyer || 0) + 1;
        } else {
          socket.emit('error', { message: 'Access denied' });
          return;
        }

        // Create message
        const message = await Message.create({
          conversationId,
          senderId: socket.userId,
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

        // Populate message
        const populatedMessage = await Message.findById(message._id)
          .populate('senderId', 'name email profileImage')
          .populate('receiverId', 'name email profileImage');

        // Emit to conversation room
        io.to(`conversation:${conversationId}`).emit('new_message', populatedMessage);

        // Emit to receiver's personal room (for notifications)
        io.to(`user:${receiverId}`).emit('message_received', {
          conversationId,
          message: populatedMessage,
        });

        socket.emit('message_sent', { messageId: message._id });
      } catch (error) {
        socket.emit('error', { message: error.message });
      }
    });

    // Mark messages as read
    socket.on('mark_read', async (conversationId) => {
      try {
        const conversation = await Conversation.findById(conversationId);
        if (!conversation) {
          return;
        }

        await Message.updateMany(
          { conversationId, receiverId: socket.userId, isRead: false },
          { isRead: true }
        );

        const seller = await Seller.findOne({ userId: socket.userId });
        if (conversation.buyerId.toString() === socket.userId.toString()) {
          conversation.unreadCountBuyer = 0;
          conversation.lastReadByBuyer = new Date();
        } else if (seller && conversation.sellerId.toString() === seller._id.toString()) {
          conversation.unreadCountSeller = 0;
          conversation.lastReadBySeller = new Date();
        }
        await conversation.save();

        // Notify other user
        io.to(`conversation:${conversationId}`).emit('messages_read', {
          conversationId,
          readBy: socket.userId,
        });
      } catch (error) {
        socket.emit('error', { message: error.message });
      }
    });

    // Typing indicator
    socket.on('typing', (data) => {
      const { conversationId, isTyping } = data;
      socket.to(`conversation:${conversationId}`).emit('user_typing', {
        userId: socket.userId,
        isTyping,
      });
    });

    // ==================== SUPPORT CHAT EVENTS ====================

    // Join support chat room
    socket.on('join_support_chat', async (chatId) => {
      try {
        const chat = await SupportChat.findById(chatId);
        if (!chat) {
          socket.emit('error', { message: 'Support chat not found' });
          return;
        }

        const isAdmin = socket.user?.roles?.includes('admin');
        const isOwner = chat.userId && chat.userId.toString() === socket.userId.toString();
        const isAssignedAdmin = chat.adminId && chat.adminId.toString() === socket.userId.toString();

        // Verify access
        if (!isAdmin && !isOwner && !isAssignedAdmin) {
          // Check if guest session matches
          if (!chat.guestSessionId || chat.guestSessionId !== socket.handshake.auth.guestSessionId) {
            socket.emit('error', { message: 'Access denied' });
            return;
          }
        }

        socket.join(`support_chat:${chatId}`);
        socket.emit('joined_support_chat', { chatId });

        // If admin joins, mark messages as read
        if (isAdmin || isAssignedAdmin) {
          await markMessagesAsRead(chatId, socket.userId, true);
        } else {
          await markMessagesAsRead(chatId, socket.userId || socket.handshake.auth.guestSessionId, false);
        }
      } catch (error) {
        socket.emit('error', { message: error.message });
      }
    });

    // Leave support chat room
    socket.on('leave_support_chat', (chatId) => {
      socket.leave(`support_chat:${chatId}`);
    });

    // Send support message
    socket.on('send_support_message', async (data) => {
      try {
        const { chatId, messageText, messageType = 'text', guestName, guestEmail, guestSessionId } = data;

        if (!chatId || !messageText) {
          socket.emit('error', { message: 'Chat ID and message text are required' });
          return;
        }

        const chat = await SupportChat.findById(chatId);
        if (!chat) {
          socket.emit('error', { message: 'Support chat not found' });
          return;
        }

        if (chat.status === 'closed') {
          socket.emit('error', { message: 'This support chat is closed' });
          return;
        }

        const isAdmin = socket.user?.roles?.includes('admin');
        const userId = socket.userId || guestSessionId;

        // Verify access
        const isOwner = chat.userId && chat.userId.toString() === socket.userId?.toString();
        const isAssignedAdmin = chat.adminId && chat.adminId.toString() === socket.userId?.toString();
        const isGuest = chat.guestSessionId === guestSessionId;

        if (!isAdmin && !isOwner && !isAssignedAdmin && !isGuest) {
          socket.emit('error', { message: 'Access denied' });
          return;
        }

        // Send message
        const message = await sendSupportMessage({
          chatId,
          userId,
          isAdmin: isAdmin || isAssignedAdmin,
          messageText,
          messageType,
          guestName,
          guestEmail,
        });

        // Populate message
        const populatedMessage = await SupportMessage.findById(message._id)
          .populate('senderId', 'name email profileImage');

        // Emit to support chat room
        io.to(`support_chat:${chatId}`).emit('support_message', populatedMessage);

        // Emit to admin room if unassigned (for notification)
        if (!chat.adminId && isAdmin) {
          io.to('admin_support').emit('new_support_chat_message', {
            chatId,
            message: populatedMessage,
          });
        }

        socket.emit('support_message_sent', { messageId: message._id });
      } catch (error) {
        socket.emit('error', { message: error.message });
      }
    });

    // Mark support messages as read
    socket.on('mark_support_read', async (chatId) => {
      try {
        const chat = await SupportChat.findById(chatId);
        if (!chat) {
          return;
        }

        const isAdmin = socket.user?.roles?.includes('admin');
        const userId = socket.userId || socket.handshake.auth.guestSessionId;

        await markMessagesAsRead(chatId, userId, isAdmin);

        // Notify other participants
        io.to(`support_chat:${chatId}`).emit('support_messages_read', {
          chatId,
          readBy: userId,
          isAdmin,
        });
      } catch (error) {
        socket.emit('error', { message: error.message });
      }
    });

    // Support chat typing indicator
    socket.on('support_typing', (data) => {
      const { chatId, isTyping } = data;
      socket.to(`support_chat:${chatId}`).emit('support_user_typing', {
        userId: socket.userId || socket.handshake.auth.guestSessionId,
        isTyping,
      });
    });

    // Admin joins admin support room (to receive notifications)
    socket.on('join_admin_support', () => {
      if (socket.user?.roles?.includes('admin')) {
        socket.join('admin_support');
        socket.emit('joined_admin_support');
      } else {
        socket.emit('error', { message: 'Admin access required' });
      }
    });

    // Disconnect
    socket.on('disconnect', () => {
      console.log(`User disconnected: ${socket.userId}`);
    });
  });

  return io;
};

