import express from "express";
import {
  createDispute,
  getUserDisputes,
  getDisputeById,
  getSellerDisputes,
  updateDispute,
  getAllDisputes,
} from "../controller/dispute.controller.js";
import { verifyJWT } from "../middlerwares/authmiddlerware.js";
import { authorizeRoles } from "../middlerwares/authmiddlerware.js";
import { apiRateLimiter } from "../middlerwares/rateLimit.middlerware.js";

const router = express.Router();

// Apply rate limiting to all routes
router.use(apiRateLimiter);

// User routes
router.post("/", verifyJWT, createDispute);
router.get("/my-disputes", verifyJWT, getUserDisputes);
router.get("/:disputeId", verifyJWT, getDisputeById);

// Seller routes
router.get("/seller/my-disputes", verifyJWT, authorizeRoles("seller"), getSellerDisputes);

// Admin routes
router.get("/admin/all", verifyJWT, authorizeRoles("admin"), getAllDisputes);
router.patch("/admin/:disputeId", verifyJWT, authorizeRoles("admin"), updateDispute);

export default router;

