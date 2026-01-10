import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import {
  getUserNotifications,
  markAsRead as markNotificationAsRead,
  markAllAsRead as markAllNotificationsAsRead,
  deleteNotification as deleteUserNotification,
  getUnreadCount as getUnreadCountService,
} from "../services/notification.service.js";
import mongoose from "mongoose";

// Retrieves user notifications with pagination and optional unread filter
const getNotifications = asyncHandler(async (req, res) => {
  const userId = req.user._id;
  const { page = 1, limit = 20, unreadOnly = false } = req.query;

  const result = await getUserNotifications(
    userId,
    parseInt(page),
    parseInt(limit),
    unreadOnly === 'true'
  );

  return res.status(200).json(
    new ApiResponse(200, result, "Notifications retrieved successfully")
  );
});

// Marks a specific notification as read
const markAsRead = asyncHandler(async (req, res) => {
  const { notificationId } = req.params;
  const userId = req.user._id;

  if (!mongoose.Types.ObjectId.isValid(notificationId)) {
    throw new ApiError(400, "Invalid notification ID");
  }

  const notification = await markNotificationAsRead(notificationId, userId);

  return res.status(200).json(
    new ApiResponse(200, notification, "Notification marked as read")
  );
});

// Marks all user notifications as read
const markAllAsRead = asyncHandler(async (req, res) => {
  const userId = req.user._id;

  const result = await markAllNotificationsAsRead(userId);

  return res.status(200).json(
    new ApiResponse(200, { updated: result.modifiedCount }, "All notifications marked as read")
  );
});

// Deletes a specific notification
const deleteNotification = asyncHandler(async (req, res) => {
  const { notificationId } = req.params;
  const userId = req.user._id;

  if (!mongoose.Types.ObjectId.isValid(notificationId)) {
    throw new ApiError(400, "Invalid notification ID");
  }

  await deleteUserNotification(notificationId, userId);

  return res.status(200).json(
    new ApiResponse(200, null, "Notification deleted successfully")
  );
});

// Retrieves count of unread notifications for the user
const getUnreadCount = asyncHandler(async (req, res) => {
  const userId = req.user._id;

  const count = await getUnreadCountService(userId);

  return res.status(200).json(
    new ApiResponse(200, { unreadCount: count }, "Unread count retrieved")
  );
});

export {
  getNotifications,
  markAsRead,
  markAllAsRead,
  deleteNotification,
  getUnreadCount,
};

