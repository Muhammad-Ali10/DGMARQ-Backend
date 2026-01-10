import { Router } from "express";
import { verifyJWT, authorizeRoles } from "../middlerwares/authmiddlerware.js";
import { messageLimiter } from "../middlerwares/rateLimit.middlerware.js";
import { validate, sendMessageValidation } from "../middlerwares/validation.middlerware.js";
import {
  createConversation,
  getConversations,
  getMessages,
  sendMessage,
  markAsRead,
  deleteConversation,
  getUnreadCount,
} from "../controller/chat.controller.js";

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
  .route("/conversation/:conversationId/read")
  .patch(verifyJWT, markAsRead);

router
  .route("/conversation/:conversationId")
  .delete(verifyJWT, deleteConversation);

router
  .route("/unread-count")
  .get(verifyJWT, getUnreadCount);

export default router;

