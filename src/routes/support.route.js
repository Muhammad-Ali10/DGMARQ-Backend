import express from "express";
import {
  createSupportChat,
  getMySupportChats,
  getSupportChatMessages,
  sendSupportMessageHandler,
  closeSupportChatHandler,
  getAllSupportChatsAdmin,
  assignAdminToChatHandler,
  getSupportStats,
} from "../controller/support.controller.js";
import { verifyJWT, authorizeRoles, optionalJWT } from "../middlerwares/authmiddlerware.js";
import { apiRateLimiter } from "../middlerwares/rateLimit.middlerware.js";

const router = express.Router();

// Apply rate limiting
router.use(apiRateLimiter);

// User routes (optional auth for anonymous support)
router.post("/", optionalJWT, createSupportChat);
router.get("/", optionalJWT, getMySupportChats);
router.get("/:chatId/messages", optionalJWT, getSupportChatMessages);
router.post("/:chatId/message", optionalJWT, sendSupportMessageHandler);
router.patch("/:chatId/close", verifyJWT, closeSupportChatHandler);

// Admin routes (require authentication and admin role)
router.get("/admin/chats", verifyJWT, authorizeRoles("admin"), getAllSupportChatsAdmin);
router.post("/admin/:chatId/assign", verifyJWT, authorizeRoles("admin"), assignAdminToChatHandler);
router.get("/admin/stats", verifyJWT, authorizeRoles("admin"), getSupportStats);

export default router;

