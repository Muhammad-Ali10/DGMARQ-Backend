import { Server } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { User } from '../models/user.model.js';
import { Message } from '../models/message.model.js';
import { Conversation } from '../models/conversation.model.js';
import { SupportChat } from '../models/support.model.js';
import { SupportMessage } from '../models/supportMessage.model.js';
import { Seller } from '../models/seller.model.js';
import { sendSupportMessage, markMessagesAsRead } from '../services/support.service.js';
import { isRedisEnabled, createRedisConnection } from '../config/redis.js';
import { logger } from '../utils/logger.js';

// ─── LRU Cache ───
class LRUCache {
  constructor(maxSize = 5000, ttlMs = 300000) {
    this.max = maxSize;
    this.ttl = ttlMs;
    this.map = new Map();
  }
  get(key) {
    const entry = this.map.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.exp) { this.map.delete(key); return undefined; }
    this.map.delete(key);
    this.map.set(key, entry);
    return entry.value;
  }
  set(key, value) {
    this.map.delete(key);
    if (this.map.size >= this.max) {
      const first = this.map.keys().next().value;
      this.map.delete(first);
    }
    this.map.set(key, { value, exp: Date.now() + this.ttl });
  }
  del(key) { this.map.delete(key); }
}

const userCache = new LRUCache(10000, 5 * 60 * 1000);
const sellerCache = new LRUCache(5000, 5 * 60 * 1000);
const convCache = new LRUCache(10000, 2 * 60 * 1000);

async function getCachedUser(userId) {
  const key = userId.toString();
  let user = userCache.get(key);
  if (user) return user;
  user = await User.findById(userId).select('-password -refreshToken').lean();
  if (user) userCache.set(key, user);
  return user;
}

async function getCachedSeller(userId) {
  const key = `byUser:${userId}`;
  let seller = sellerCache.get(key);
  if (seller !== undefined) return seller;
  seller = await Seller.findOne({ userId }).lean();
  sellerCache.set(key, seller);
  return seller;
}

async function getCachedSellerById(sellerId) {
  const key = `byId:${sellerId}`;
  let seller = sellerCache.get(key);
  if (seller !== undefined) return seller;
  seller = await Seller.findById(sellerId).select('userId').lean();
  sellerCache.set(key, seller);
  return seller;
}

async function getCachedConversation(conversationId) {
  const key = conversationId.toString();
  let conv = convCache.get(key);
  if (conv) return conv;
  conv = await Conversation.findById(conversationId).lean();
  if (conv) convCache.set(key, conv);
  return conv;
}

// ─── Rate limiter ───
const socketRateLimits = new Map();
function checkSocketRate(socketId, event, maxPerMin = 30) {
  const key = `${socketId}:${event}`;
  const now = Date.now();
  let bucket = socketRateLimits.get(key);
  if (!bucket || now - bucket.windowStart > 60000) {
    bucket = { windowStart: now, count: 0 };
    socketRateLimits.set(key, bucket);
  }
  bucket.count++;
  return bucket.count <= maxPerMin;
}
setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of socketRateLimits) {
    if (now - bucket.windowStart > 120000) socketRateLimits.delete(key);
  }
}, 120000);

// ─── Online status tracking ───
const onlineUsers = new Map(); // userId -> Set<socketId>

function setUserOnline(io, userId, socketId) {
  const uid = userId.toString();
  if (!onlineUsers.has(uid)) onlineUsers.set(uid, new Set());
  onlineUsers.get(uid).add(socketId);
  // Broadcast to all connected clients
  io.emit('user_status', { userId: uid, status: 'online' });
}

function setUserOffline(io, userId, socketId) {
  const uid = userId.toString();
  const sockets = onlineUsers.get(uid);
  if (sockets) {
    sockets.delete(socketId);
    if (sockets.size === 0) {
      onlineUsers.delete(uid);
      io.emit('user_status', { userId: uid, status: 'offline' });
    }
  }
}

function isUserOnline(userId) {
  const sockets = onlineUsers.get(userId.toString());
  return sockets && sockets.size > 0;
}

// ─── Main initializer ───
export const initializeSocketIO = (server) => {
  const allowedOrigins = process.env.NODE_ENV === 'production'
    ? [process.env.FRONTEND_URL || 'https://dgmarq.com']
    : ['http://localhost:5173'];

  const io = new Server(server, {
    cors: {
      origin: (origin, callback) => {
        if (!origin) return callback(null, true);
        if (allowedOrigins.includes(origin)) return callback(null, true);
        if (process.env.NODE_ENV !== 'production' &&
            (origin.includes('localhost') || origin.includes('127.0.0.1'))) {
          return callback(null, true);
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
    maxHttpBufferSize: 1e6,
    connectionStateRecovery: {
      maxDisconnectionDuration: 2 * 60 * 1000,
      skipMiddlewares: true,
    },
  });

  // ─── Redis adapter ───
  if (isRedisEnabled()) {
    try {
      const pubClient = createRedisConnection();
      const subClient = pubClient.duplicate();
      io.adapter(createAdapter(pubClient, subClient));
      logger.success('[Socket.IO] Redis adapter attached');
    } catch (err) {
      logger.warn('[Socket.IO] Redis adapter failed, using in-memory', err.message);
    }
  } else {
    logger.info('[Socket.IO] Running with in-memory adapter');
  }

  // ─── Auth middleware ───
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth.token ||
                    socket.handshake.headers.authorization?.split(' ')[1];
      if (!token) return next(new Error('Authentication error: No token provided'));

      const decoded = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET);
      const user = await getCachedUser(decoded._id);
      if (!user) return next(new Error('Authentication error: User not found'));

      socket.userId = user._id;
      socket.user = user;
      next();
    } catch (error) {
      next(new Error('Authentication error: Invalid token'));
    }
  });

  // ─── Connection handler ───
  io.on('connection', (socket) => {
    const userId = socket.userId.toString();

    // Join personal room + track online status
    socket.join(`user:${userId}`);
    setUserOnline(io, userId, socket.id);

    // Send current online users list to newly connected client
    const onlineList = [];
    for (const [uid, sockets] of onlineUsers) {
      if (sockets.size > 0) onlineList.push(uid);
    }
    socket.emit('online_users', onlineList);

    // ─── Get user online status ───
    socket.on('check_online', (userIds) => {
      if (!Array.isArray(userIds)) return;
      const statuses = {};
      for (const uid of userIds) {
        statuses[uid] = isUserOnline(uid);
      }
      socket.emit('online_statuses', statuses);
    });

    // ══════════════════════════════════════
    // ── BUYER / SELLER CHAT
    // ══════════════════════════════════════

    socket.on('join_conversation', async (conversationId) => {
      try {
        const convIdStr = conversationId.toString();
        const [conversation, seller] = await Promise.all([
          getCachedConversation(convIdStr),
          getCachedSeller(socket.userId),
        ]);
        if (!conversation) { socket.emit('error', { message: 'Conversation not found' }); return; }

        const isBuyer = conversation.buyerId.toString() === socket.userId.toString();
        const isSeller = seller && conversation.sellerId.toString() === seller._id.toString();
        if (!isBuyer && !isSeller) { socket.emit('error', { message: 'Access denied' }); return; }

        // Leave any other conversation rooms first (prevents cross-chat leaks)
        for (const room of socket.rooms) {
          if (room.startsWith('conversation:') && room !== `conversation:${convIdStr}`) {
            socket.leave(room);
          }
        }

        socket.join(`conversation:${convIdStr}`);
        socket.emit('joined_conversation', { conversationId: convIdStr });
      } catch (error) {
        socket.emit('error', { message: error.message });
      }
    });

    socket.on('leave_conversation', (conversationId) => {
      socket.leave(`conversation:${conversationId.toString()}`);
    });

    socket.on('send_message', async (data, ackCallback) => {
      if (!checkSocketRate(socket.id, 'send_message', 30)) {
        socket.emit('error', { message: 'Sending too fast. Please slow down.' });
        if (typeof ackCallback === 'function') ackCallback({ error: 'rate_limited' });
        return;
      }
      try {
        const { conversationId, messageText, messageType = 'text', attachment = null } = data;
        if (!conversationId || !messageText) {
          socket.emit('error', { message: 'Conversation ID and message text are required' });
          if (typeof ackCallback === 'function') ackCallback({ error: 'invalid_data' });
          return;
        }

        const convIdStr = conversationId.toString();
        const [conversation, seller] = await Promise.all([
          getCachedConversation(convIdStr),
          getCachedSeller(socket.userId),
        ]);
        if (!conversation) { socket.emit('error', { message: 'Conversation not found' }); return; }

        let receiverId;
        if (conversation.buyerId.toString() === socket.userId.toString()) {
          const sellerRecord = await getCachedSellerById(conversation.sellerId);
          if (!sellerRecord) { socket.emit('error', { message: 'Seller not found' }); return; }
          receiverId = sellerRecord.userId;
        } else if (seller && conversation.sellerId.toString() === seller._id.toString()) {
          receiverId = conversation.buyerId;
        } else {
          socket.emit('error', { message: 'Access denied' });
          return;
        }

        const receiverIdStr = receiverId.toString();

        // DB writes in parallel
        const [message] = await Promise.all([
          Message.create({
            conversationId: convIdStr,
            senderId: socket.userId,
            receiverId,
            messageText,
            messageType,
            attachment,
            isRead: false,
            sentAt: new Date(),
          }),
          Conversation.findByIdAndUpdate(convIdStr, {
            lastMessage: messageText,
            lastMessageAt: new Date(),
          }),
        ]);

        convCache.del(convIdStr);

        // Populate sender info
        const senderUser = await getCachedUser(socket.userId);
        const populatedMessage = {
          ...message.toObject(),
          conversationId: convIdStr, // Always string for consistency
          senderId: senderUser
            ? { _id: senderUser._id, name: senderUser.name, email: senderUser.email, profileImage: senderUser.profileImage }
            : { _id: socket.userId },
        };

        // ── Emit Strategy (clean separation) ──
        // 1. Conversation room → everyone in the room gets new_message (includes sender)
        io.to(`conversation:${convIdStr}`).emit('new_message', populatedMessage);

        // 2. Receiver's personal room → message_received (backup if not in conversation room)
        //    This uses a DIFFERENT event name to avoid duplicate processing
        io.to(`user:${receiverIdStr}`).emit('message_received', {
          conversationId: convIdStr,
          message: populatedMessage,
        });

        // 3. ACK to sender
        if (typeof ackCallback === 'function') {
          ackCallback({ success: true, messageId: message._id.toString() });
        }
        socket.emit('message_sent', { messageId: message._id, conversationId: convIdStr });
      } catch (error) {
        socket.emit('error', { message: error.message });
        if (typeof ackCallback === 'function') ackCallback({ error: error.message });
      }
    });

    socket.on('mark_read', async (conversationId) => {
      if (!checkSocketRate(socket.id, 'mark_read', 10)) return;
      try {
        const convIdStr = conversationId.toString();
        const [conversation, seller] = await Promise.all([
          getCachedConversation(convIdStr),
          getCachedSeller(socket.userId),
        ]);
        if (!conversation) return;

        Message.updateMany(
          { conversationId: new mongoose.Types.ObjectId(convIdStr), receiverId: socket.userId, isRead: false },
          { isRead: true }
        ).maxTimeMS(5000).exec().catch(() => {});

        const isBuyer = conversation.buyerId.toString() === socket.userId.toString();
        const isSeller = seller && conversation.sellerId.toString() === seller._id.toString();

        if (isBuyer) {
          Conversation.findByIdAndUpdate(convIdStr, { unreadCountBuyer: 0, lastReadByBuyer: new Date() }).catch(() => {});
        } else if (isSeller) {
          Conversation.findByIdAndUpdate(convIdStr, { unreadCountSeller: 0, lastReadBySeller: new Date() }).catch(() => {});
        }
        convCache.del(convIdStr);

        io.to(`conversation:${convIdStr}`).emit('messages_read', { conversationId: convIdStr, readBy: socket.userId });
      } catch (error) { /* silent */ }
    });

    socket.on('typing', (data) => {
      if (!checkSocketRate(socket.id, 'typing', 60)) return;
      const { conversationId, isTyping } = data;
      socket.to(`conversation:${conversationId}`).emit('user_typing', { userId: socket.userId, isTyping });
    });

    // ══════════════════════════════════════
    // ── SUPPORT CHAT
    // ══════════════════════════════════════

    socket.on('join_support_chat', async (chatId) => {
      try {
        const chat = await SupportChat.findById(chatId).lean();
        if (!chat) { socket.emit('error', { message: 'Support chat not found' }); return; }

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
          markMessagesAsRead(chatId, socket.userId, true).catch(() => {});
        } else {
          markMessagesAsRead(chatId, socket.userId || socket.handshake.auth.guestSessionId, false).catch(() => {});
        }
      } catch (error) {
        socket.emit('error', { message: error.message });
      }
    });

    socket.on('leave_support_chat', (chatId) => {
      socket.leave(`support_chat:${chatId}`);
    });

    socket.on('send_support_message', async (data) => {
      if (!checkSocketRate(socket.id, 'send_support_message', 30)) {
        socket.emit('error', { message: 'Sending too fast. Please slow down.' });
        return;
      }
      try {
        const { chatId, messageText, messageType = 'text', guestName, guestEmail, guestSessionId } = data;
        if (!chatId || !messageText) {
          socket.emit('error', { message: 'Chat ID and message text are required' });
          return;
        }

        const chat = await SupportChat.findById(chatId).lean();
        if (!chat) { socket.emit('error', { message: 'Support chat not found' }); return; }
        if (chat.status === 'closed') { socket.emit('error', { message: 'This support chat is closed' }); return; }

        const isAdmin = socket.user?.roles?.includes('admin');
        const msgUserId = socket.userId || guestSessionId;
        const isOwner = chat.userId && chat.userId.toString() === socket.userId?.toString();
        const isAssignedAdmin = chat.adminId && chat.adminId.toString() === socket.userId?.toString();
        const isGuest = chat.guestSessionId === guestSessionId;

        if (!isAdmin && !isOwner && !isAssignedAdmin && !isGuest) {
          socket.emit('error', { message: 'Access denied' });
          return;
        }

        const message = await sendSupportMessage({
          chatId, userId: msgUserId,
          isAdmin: isAdmin || isAssignedAdmin,
          messageText, messageType,
          guestName, guestEmail,
        });

        const populatedMessage = await SupportMessage.findById(message._id)
          .populate('senderId', 'name email profileImage')
          .lean();

        io.to(`support_chat:${chatId}`).emit('support_message', populatedMessage);

        if (!chat.adminId && isAdmin) {
          io.to('admin_support').emit('new_support_chat_message', { chatId, message: populatedMessage });
        }

        socket.emit('support_message_sent', { messageId: message._id });
      } catch (error) {
        socket.emit('error', { message: error.message });
      }
    });

    socket.on('mark_support_read', async (chatId) => {
      if (!checkSocketRate(socket.id, 'mark_support_read', 10)) return;
      try {
        const chat = await SupportChat.findById(chatId).lean();
        if (!chat) return;
        const isAdmin = socket.user?.roles?.includes('admin');
        const readUserId = socket.userId || socket.handshake.auth.guestSessionId;
        await markMessagesAsRead(chatId, readUserId, isAdmin);
        io.to(`support_chat:${chatId}`).emit('support_messages_read', { chatId, readBy: readUserId, isAdmin });
      } catch (error) { /* silent */ }
    });

    socket.on('support_typing', (data) => {
      if (!checkSocketRate(socket.id, 'support_typing', 60)) return;
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

    // ─── Disconnect ───
    socket.on('disconnect', () => {
      setUserOffline(io, userId, socket.id);
    });
  });

  io.engine.on('connection_error', (err) => {
    logger.warn('[Socket.IO] Connection error', { code: err.code, message: err.message });
  });

  return io;
};
