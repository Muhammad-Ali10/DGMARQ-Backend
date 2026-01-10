import express from "express";
import {
  getMyLicenseKeys,
  revealLicenseKey,
} from "../controller/licensekey.controller.js";
import { verifyJWT } from "../middlerwares/authmiddlerware.js";
import { apiRateLimiter } from "../middlerwares/rateLimit.middlerware.js";

const router = express.Router();

// Apply rate limiting
router.use(apiRateLimiter);

// User routes - require authentication
router.get("/my-keys", verifyJWT, getMyLicenseKeys);
router.get("/:keyId/reveal", verifyJWT, revealLicenseKey);

export default router;

