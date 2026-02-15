import { Router } from "express";
import { verifyJWT } from "../middlerwares/authmiddlerware.js";
import {
  getNotifications,
  markAsRead,
  markAllAsRead,
  deleteNotification,
  getUnreadCount,
} from "../controller/notification.controller.js";


const router = Router();

router
  .route("/my-notifications")
  .get(verifyJWT, getNotifications);

router
  .route("/unread-count")
  .get(verifyJWT, getUnreadCount);

router
  .route("/:notificationId/read")
  .patch(verifyJWT, markAsRead);

router
  .route("/read-all")
  .patch(verifyJWT, markAllAsRead);

router
  .route("/:notificationId")
  .delete(verifyJWT, deleteNotification);

export default router;

