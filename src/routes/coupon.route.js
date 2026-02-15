import express from "express";
import {
  createCoupon,
  getAllCoupons,
  getActiveCoupons,
  validateCoupon,
  getCouponById,
  updateCoupon,
  deleteCoupon,
} from "../controller/coupon.controller.js";
import { verifyJWT } from "../middlerwares/authmiddlerware.js";
import { authorizeRoles } from "../middlerwares/authmiddlerware.js";
import { apiRateLimiter } from "../middlerwares/rateLimit.middlerware.js";

const router = express.Router();

router.use(apiRateLimiter);

router.get("/active", getActiveCoupons);
router.post("/validate", validateCoupon);

router.post("/", verifyJWT, authorizeRoles("admin"), createCoupon);
router.get("/", verifyJWT, authorizeRoles("admin"), getAllCoupons);
router.get("/:couponId", verifyJWT, authorizeRoles("admin"), getCouponById);
router.patch("/:couponId", verifyJWT, authorizeRoles("admin"), updateCoupon);
router.delete("/:couponId", verifyJWT, authorizeRoles("admin"), deleteCoupon);

export default router;

