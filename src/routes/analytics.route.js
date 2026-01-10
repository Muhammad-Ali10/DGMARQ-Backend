import express from "express";
import {
  getProductAnalytics,
  incrementProductViews,
  getCategoryAnalytics,
  getTopProducts,
  getAnalyticsDashboard,
  getSellerMonthlyAnalytics,
  getAdminMonthlyAnalytics,
  createCustomReport,
  exportReportCSV,
  exportReportPDF,
  getRealTimeCounters,
  trackUserBehavior,
  getUserBehaviorAnalytics,
} from "../controller/analytics.controller.js";
import { verifyJWT } from "../middlerwares/authmiddlerware.js";
import { authorizeRoles } from "../middlerwares/authmiddlerware.js";
import { apiRateLimiter } from "../middlerwares/rateLimit.middlerware.js";

const router = express.Router();

// Apply rate limiting to all routes
router.use(apiRateLimiter);

// Public routes
router.get("/product/:productId", getProductAnalytics);
router.post("/product/:productId/view", incrementProductViews);
router.get("/category/:categoryId", getCategoryAnalytics);

// Seller routes
router.get("/seller/monthly", verifyJWT, authorizeRoles("seller"), getSellerMonthlyAnalytics);

// Admin routes
router.get("/top-products", verifyJWT, authorizeRoles("admin"), getTopProducts);
router.get("/dashboard", verifyJWT, authorizeRoles("admin"), getAnalyticsDashboard);
router.get("/admin/monthly", verifyJWT, authorizeRoles("admin"), getAdminMonthlyAnalytics);

// Custom reports
router.post("/custom-report", verifyJWT, authorizeRoles("admin"), createCustomReport);
router.get("/export/csv", verifyJWT, authorizeRoles("admin"), exportReportCSV);
router.get("/export/pdf", verifyJWT, authorizeRoles("admin"), exportReportPDF);

// Real-time analytics
router.get("/realtime", verifyJWT, authorizeRoles("admin"), getRealTimeCounters);

// User behavior
router.post("/track-behavior", trackUserBehavior);
router.get("/user-behavior", verifyJWT, authorizeRoles("admin"), getUserBehaviorAnalytics);

export default router;

