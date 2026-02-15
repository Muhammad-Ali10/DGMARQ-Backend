import { Router } from "express";
import { verifyJWT, authorizeRoles } from "../middlerwares/authmiddlerware.js";
import { messageLimiter } from "../middlerwares/rateLimit.middlerware.js";
import { validate, sendMessageValidation, sendImageMessageValidation } from "../middlerwares/validation.middlerware.js";
import {
  createConversation,
  getConversations,
  getMessages,
  sendMessage,
  sendImageMessage,
  markAsRead,
  deleteConversation,
  getUnreadCount,
} from "../controller/chat.controller.js";
import { uploadChatImage } from "../middlerwares/multer.middlerware.js";

const router = Router();

router
  .route("/conversation")
  .post(verifyJWT, authorizeRoles("customer", "admin"), createConversation);

router
  .route("/conversations")
  .get(verifyJWT, getConversations);

router
  .route("/conversation/:conversationId/messages")
  .get(verifyJWT, getMessages);

router
  .route("/message")
  .post(
    messageLimiter,
    verifyJWT,
    validate(sendMessageValidation),
    sendMessage
  );

router
  .route("/message/image")
  .post(
    messageLimiter,
    verifyJWT,
    uploadChatImage,
    validate(sendImageMessageValidation),
    sendImageMessage
  );

router
  .route("/conversation/:conversationId/read")
  .patch(verifyJWT, markAsRead);

router
  .route("/conversation/:conversationId")
  .delete(verifyJWT, deleteConversation);

router
  .route("/unread-count")
  .get(verifyJWT, getUnreadCount);

export default router;

