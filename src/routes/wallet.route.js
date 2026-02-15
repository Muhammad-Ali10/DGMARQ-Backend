import express from "express";
import { verifyJWT } from "../middlerwares/authmiddlerware.js";
import { authorizeRoles } from "../middlerwares/authmiddlerware.js";
import { apiRateLimiter } from "../middlerwares/rateLimit.middlerware.js";
import {
  getWalletBalanceController,
  getWalletTransactionsController,
} from "../controller/wallet.controller.js";


const router = express.Router();

router.use(apiRateLimiter);

router.get("/balance", verifyJWT, authorizeRoles("customer", "admin"), getWalletBalanceController);
router.get("/transactions", verifyJWT, authorizeRoles("customer", "admin"), getWalletTransactionsController);

export default router;
