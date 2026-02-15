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
import { validateSubscriptionPlanId } from "../middlerwares/subscriptionValidation.middlerware.js";


const router = express.Router();

router.use(apiRateLimiter);

router.get("/plans", getSubscriptionPlans);

router.get("/me", verifyJWT, getMySubscription);
router.post("/subscribe", verifyJWT, validateSubscriptionPlanId(), subscribe);
router.post("/confirm", verifyJWT, confirmSubscription);
router.post("/cancel", verifyJWT, cancelMySubscription);
router.post("/renew", verifyJWT, renewMySubscription);

router.get("/", verifyJWT, authorizeRoles("admin"), getAllSubscriptions);
router.get("/stats", verifyJWT, authorizeRoles("admin"), getSubscriptionStats);

export default router;

