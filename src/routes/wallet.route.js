import express from "express";
import { verifyJWT } from "../middlerwares/authmiddlerware.js";
import { authorizeRoles } from "../middlerwares/authmiddlerware.js";
import { apiRateLimiter } from "../middlerwares/rateLimit.middlerware.js";
import {
  getWalletBalanceController,
  getWalletTransactionsController,
} from "../controller/wallet.controller.js";

const router = express.Router();

// Apply rate limiting to all routes
router.use(apiRateLimiter);

// Customer routes (wallet is purchase-only, no withdrawal)
router.get("/balance", verifyJWT, authorizeRoles("customer", "admin"), getWalletBalanceController);
router.get("/transactions", verifyJWT, authorizeRoles("customer", "admin"), getWalletTransactionsController);

export default router;
