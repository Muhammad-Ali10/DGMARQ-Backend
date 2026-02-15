import express from "express";
import {
  linkPayoutAccount,
  getMyPayoutAccount,
  getPayPalConnectUrl,
  paypalOAuthCallback,
  verifyPayoutAccount,
  blockPayoutAccount,
  getSellerPayoutAccount,
  getSellersPayoutStatus,
} from "../controller/payoutAccount.controller.js";
import { verifyJWT, authorizeRoles } from "../middlerwares/authmiddlerware.js";
import { apiRateLimiter } from "../middlerwares/rateLimit.middlerware.js";


const router = express.Router();

router.use(apiRateLimiter);

router.post("/link", verifyJWT, authorizeRoles("seller"), linkPayoutAccount);
router.get("/my", verifyJWT, authorizeRoles("seller"), getMyPayoutAccount);
router.get("/paypal/connect", verifyJWT, authorizeRoles("seller"), getPayPalConnectUrl);
router.get("/paypal/callback", paypalOAuthCallback);

router.patch("/:accountId/verify", verifyJWT, authorizeRoles("admin"), verifyPayoutAccount);
router.patch("/:accountId/block", verifyJWT, authorizeRoles("admin"), blockPayoutAccount);
router.get("/seller/:sellerId", verifyJWT, authorizeRoles("admin"), getSellerPayoutAccount);
router.get("/sellers/status", verifyJWT, authorizeRoles("admin"), getSellersPayoutStatus);

export default router;

