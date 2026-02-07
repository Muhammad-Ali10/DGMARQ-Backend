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

// Purpose: Support chat routes for user and admin chat management

const router = express.Router();

router.use(apiRateLimiter);

router.post("/", optionalJWT, createSupportChat);
router.get("/", optionalJWT, getMySupportChats);
router.get("/:chatId/messages", optionalJWT, getSupportChatMessages);
router.post("/:chatId/message", optionalJWT, sendSupportMessageHandler);
router.patch("/:chatId/close", verifyJWT, closeSupportChatHandler);

router.get("/admin/chats", verifyJWT, authorizeRoles("admin"), getAllSupportChatsAdmin);
router.post("/admin/:chatId/assign", verifyJWT, authorizeRoles("admin"), assignAdminToChatHandler);
router.get("/admin/stats", verifyJWT, authorizeRoles("admin"), getSupportStats);

export default router;
