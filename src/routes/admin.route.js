// Purpose: Admin routes for managing sellers, products, payouts, users, dashboard, chat moderation, and platform settings
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
  getHomePageSEO,
  updateHomePageSEO,
  getBuyerHandlingFeeSetting,
  updateBuyerHandlingFeeSetting,
  getHandlingFeeStats,
} from "../controller/admin.controller.js";
const router = Router();

router.use(verifyJWT, authorizeRoles("admin"));

router.route("/seller/:sellerId/approve").post(approveSeller);
router.route("/seller/:sellerId/reject").post(rejectSeller);
router.route("/seller/:sellerId/block").post(blockSeller);
router.route("/seller/:sellerId").get(getSellerDetails);
router.route("/sellers/pending").get(getPendingSellers);
router.route("/sellers").get(getAllSellers);

router.route("/product/:productId/approve").post(approveProduct);
router.route("/product/:productId/reject").post(rejectProduct);
router.route("/product/:productId").get(getProductDetails);
router.route("/products/pending").get(getPendingProducts);
router.route("/products").get(getAllProducts);

router.route("/payouts").get(getAllPayouts);
router.route("/payout/:payoutId/process").post(processPayout);

router.route("/users").get(getAllUsers);
router.route("/user/:userId/ban").post(banUser);

router.route("/dashboard/stats").get(getDashboardStats);

router.route("/chat/:conversationId/moderate").post(moderateChat);

router.route("/settings/commission-rate").get(getCommissionRate).patch(updateCommissionRate);
router.route("/settings/auto-approve-products").get(getAutoApproveSetting).patch(updateAutoApproveSetting);
router.route("/settings/seo/home").get(getHomePageSEO).patch(updateHomePageSEO);
router.route("/settings/buyer-handling-fee").get(getBuyerHandlingFeeSetting).patch(updateBuyerHandlingFeeSetting);
router.route("/stats/handling-fees").get(getHandlingFeeStats);

export default router;

