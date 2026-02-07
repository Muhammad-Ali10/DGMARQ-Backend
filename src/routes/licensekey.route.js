import express from "express";
import {
  getMyLicenseKeys,
  revealLicenseKey,
} from "../controller/licensekey.controller.js";
import { verifyJWT } from "../middlerwares/authmiddlerware.js";
import { apiRateLimiter } from "../middlerwares/rateLimit.middlerware.js";

// Purpose: License key routes for authenticated users to view and reveal keys

const router = express.Router();

router.use(apiRateLimiter);

router.get("/my-keys", verifyJWT, getMyLicenseKeys);
router.get("/:keyId/reveal", verifyJWT, revealLicenseKey);

export default router;

