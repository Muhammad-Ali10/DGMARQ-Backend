import express from "express";
import {
  getMySubscription,
  subscribe,
  confirmSubscription,
  cancelMySubscription,
  renewMySubscription,
  getAllSubscriptions,
  getSubscriptionStats,
  getSubscriptionPlans,
} from "../controller/subscription.controller.js";
import { verifyJWT } from "../middlerwares/authmiddlerware.js";
import { authorizeRoles } from "../middlerwares/authmiddlerware.js";
import { apiRateLimiter } from "../middlerwares/rateLimit.middlerware.js";

const router = express.Router();

// Apply rate limiting
router.use(apiRateLimiter);

// Public routes
router.get("/plans", getSubscriptionPlans);

// User routes
router.get("/me", verifyJWT, getMySubscription);
router.post("/subscribe", verifyJWT, subscribe);
router.post("/confirm", verifyJWT, confirmSubscription);
router.post("/cancel", verifyJWT, cancelMySubscription);
router.post("/renew", verifyJWT, renewMySubscription);

// Admin routes
router.get("/", verifyJWT, authorizeRoles("admin"), getAllSubscriptions);
router.get("/stats", verifyJWT, authorizeRoles("admin"), getSubscriptionStats);

export default router;

