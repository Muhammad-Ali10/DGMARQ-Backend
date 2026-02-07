import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { User } from '../models/user.model.js';
import { Message } from '../models/message.model.js';
import { Conversation } from '../models/conversation.model.js';
import { SupportChat } from '../models/support.model.js';
import { SupportMessage } from '../models/supportMessage.model.js';
import { Seller } from '../models/seller.model.js';
import { sendSupportMessage, markMessagesAsRead } from '../services/support.service.js';
import { createNotification } from '../services/notification.service.js';

// Purpose: Initialize and configure Socket.IO server with authentication and real-time messaging
export const initializeSocketIO = (server) => {
  const allowedOrigins = process.env.NODE_ENV === 'production'
    ? ['https://dgmarq.com']
    : ['http://localhost:5173'];
  
  const io = new Server(server, {
    cors: {
      origin: (origin, callback) => {
        if (!origin) return callback(null, true);
        
        if (allowedOrigins.includes(origin)) {
          return callback(null, true);
        }
        
        if (process.env.NODE_ENV !== 'production') {
          if (origin.includes('localhost') || origin.includes('127.0.0.1')) {
            return callback(null, true);
          }
        }
        
        callback(new Error('Not allowed by CORS'));
      },
      credentials: true,
      methods: ['GET', 'POST'],
      allowedHeaders: ['Content-Type', 'Authorization'],
    },
    transports: ['websocket', 'polling'],
    allowEIO3: true,
    pingTimeout: 60000,
    pingInterval: 25000,
  });

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
    socket.join(`user:${socket.userId}`);

    socket.on('join_conversation', async (conversationId) => {
      try {
        const [conversation, seller] = await Promise.all([
          Conversation.findById(conversationId).lean(),
          Seller.findOne({ userId: socket.userId }).lean()
        ]);
        
        if (!conversation) {
          socket.emit('error', { message: 'Conversation not found' });
          return;
        }

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

    socket.on('leave_conversation', (conversationId) => {
      socket.leave(`conversation:${conversationId}`);
    });

    socket.on('send_message', async (data) => {
      try {
        const { conversationId, messageText, messageType = 'text', attachment = null } = data;

        if (!conversationId || !messageText) {
          socket.emit('error', { message: 'Conversation ID and message text are required' });
          return;
        }

        const [conversation, seller] = await Promise.all([
          Conversation.findById(conversationId).lean(),
          Seller.findOne({ userId: socket.userId }).lean()
        ]);
        
        if (!conversation) {
          socket.emit('error', { message: 'Conversation not found' });
          return;
        }

        let receiverId;

        if (conversation.buyerId.toString() === socket.userId.toString()) {
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

        await Conversation.findByIdAndUpdate(conversationId, {
          lastMessage: messageText,
          lastMessageAt: new Date(),
        });

        const populatedMessage = await Message.findById(message._id)
          .populate('senderId', 'name email profileImage')
          .populate('receiverId', 'name email profileImage');

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
            senderId: socket.userId.toString(),
            senderName: senderName,
            senderAvatar: populatedMessage.senderId?.profileImage || null,
          },
          `/user/chat?conversation=${conversationId}`,
          'high'
        ).catch((err) => {
        });

        io.to(`conversation:${conversationId}`).emit('new_message', populatedMessage);

        io.to(`user:${receiverId}`).emit('message_received', {
          conversationId,
          message: populatedMessage,
        });

        io.to(`user:${receiverId}`).emit('notification_new', {
          type: 'chat',
          conversationId: conversationId.toString(),
        });

        socket.emit('message_sent', { messageId: message._id });
      } catch (error) {
        socket.emit('error', { message: error.message });
      }
    });

    socket.on('mark_read', async (conversationId) => {
      try {
        const [conversation, seller] = await Promise.all([
          Conversation.findById(conversationId).lean(),
          Seller.findOne({ userId: socket.userId }).lean()
        ]);
        
        if (!conversation) {
          return;
        }

        Message.updateMany(
          { 
            conversationId: new mongoose.Types.ObjectId(conversationId), 
            receiverId: socket.userId, 
            isRead: false 
          },
          { isRead: true }
        )
          .maxTimeMS(5000)
          .hint({ conversationId: 1, receiverId: 1, isRead: 1 })
          .exec()
          .catch(() => {});

        const isBuyer = conversation.buyerId.toString() === socket.userId.toString();
        const isSeller = seller && conversation.sellerId.toString() === seller._id.toString();
        
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

        io.to(`conversation:${conversationId}`).emit('messages_read', {
          conversationId,
          readBy: socket.userId,
        });
      } catch (error) {
      }
    });

    socket.on('typing', (data) => {
      const { conversationId, isTyping } = data;
      socket.to(`conversation:${conversationId}`).emit('user_typing', {
        userId: socket.userId,
        isTyping,
      });
    });

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

        if (!isAdmin && !isOwner && !isAssignedAdmin) {
          if (!chat.guestSessionId || chat.guestSessionId !== socket.handshake.auth.guestSessionId) {
            socket.emit('error', { message: 'Access denied' });
            return;
          }
        }

        socket.join(`support_chat:${chatId}`);
        socket.emit('joined_support_chat', { chatId });

        if (isAdmin || isAssignedAdmin) {
          await markMessagesAsRead(chatId, socket.userId, true);
        } else {
          await markMessagesAsRead(chatId, socket.userId || socket.handshake.auth.guestSessionId, false);
        }
      } catch (error) {
        socket.emit('error', { message: error.message });
      }
    });

    socket.on('leave_support_chat', (chatId) => {
      socket.leave(`support_chat:${chatId}`);
    });

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

        const isOwner = chat.userId && chat.userId.toString() === socket.userId?.toString();
        const isAssignedAdmin = chat.adminId && chat.adminId.toString() === socket.userId?.toString();
        const isGuest = chat.guestSessionId === guestSessionId;

        if (!isAdmin && !isOwner && !isAssignedAdmin && !isGuest) {
          socket.emit('error', { message: 'Access denied' });
          return;
        }

        const message = await sendSupportMessage({
          chatId,
          userId,
          isAdmin: isAdmin || isAssignedAdmin,
          messageText,
          messageType,
          guestName,
          guestEmail,
        });

        const populatedMessage = await SupportMessage.findById(message._id)
          .populate('senderId', 'name email profileImage');

        io.to(`support_chat:${chatId}`).emit('support_message', populatedMessage);

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

    socket.on('mark_support_read', async (chatId) => {
      try {
        const chat = await SupportChat.findById(chatId);
        if (!chat) {
          return;
        }

        const isAdmin = socket.user?.roles?.includes('admin');
        const userId = socket.userId || socket.handshake.auth.guestSessionId;

        await markMessagesAsRead(chatId, userId, isAdmin);

        io.to(`support_chat:${chatId}`).emit('support_messages_read', {
          chatId,
          readBy: userId,
          isAdmin,
        });
      } catch (error) {
        socket.emit('error', { message: error.message });
      }
    });

    socket.on('support_typing', (data) => {
      const { chatId, isTyping } = data;
      socket.to(`support_chat:${chatId}`).emit('support_user_typing', {
        userId: socket.userId || socket.handshake.auth.guestSessionId,
        isTyping,
      });
    });

    socket.on('join_admin_support', () => {
      if (socket.user?.roles?.includes('admin')) {
        socket.join('admin_support');
        socket.emit('joined_admin_support');
      } else {
        socket.emit('error', { message: 'Admin access required' });
      }
    });

    socket.on('disconnect', () => {
    });
  });

  return io;
};

