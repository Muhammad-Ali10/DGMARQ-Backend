import { Router } from "express";
import { verifyJWT, authorizeRoles } from "../middlerwares/authmiddlerware.js";
import {
  approveSeller,
  rejectSeller,
  getPendingSellers,
  getAllSellers,
  getSellerDetails,
  blockSeller,
  approveProduct,
  rejectProduct,
  getPendingProducts,
  getAllProducts,
  getProductDetails,
  getAllPayouts,
  processPayout,
  getAllUsers,
  banUser,
  getDashboardStats,
  moderateChat,
  getCommissionRate,
  updateCommissionRate,
  getAutoApproveSetting,
  updateAutoApproveSetting,
} from "../controller/admin.controller.js";
const router = Router();

// All admin routes require admin role
router.use(verifyJWT, authorizeRoles("admin"));

// Seller management
router.route("/seller/:sellerId/approve").post(approveSeller);
router.route("/seller/:sellerId/reject").post(rejectSeller);
router.route("/seller/:sellerId/block").post(blockSeller);
router.route("/seller/:sellerId").get(getSellerDetails);
router.route("/sellers/pending").get(getPendingSellers);
router.route("/sellers").get(getAllSellers);

// Product management
router.route("/product/:productId/approve").post(approveProduct);
router.route("/product/:productId/reject").post(rejectProduct);
router.route("/product/:productId").get(getProductDetails);
router.route("/products/pending").get(getPendingProducts);
router.route("/products").get(getAllProducts);

// Payout management
router.route("/payouts").get(getAllPayouts);
router.route("/payout/:payoutId/process").post(processPayout);

// User management
router.route("/users").get(getAllUsers);
router.route("/user/:userId/ban").post(banUser);

// Dashboard
router.route("/dashboard/stats").get(getDashboardStats);

// Chat moderation
router.route("/chat/:conversationId/moderate").post(moderateChat);

// Platform settings
router.route("/settings/commission-rate").get(getCommissionRate).patch(updateCommissionRate);
router.route("/settings/auto-approve-products").get(getAutoApproveSetting).patch(updateAutoApproveSetting);

export default router;

