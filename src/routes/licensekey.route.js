import express from "express";
import {
  getMyLicenseKeys,
  revealLicenseKey,
} from "../controller/licensekey.controller.js";
import { verifyJWT } from "../middlerwares/authmiddlerware.js";


const router = express.Router();

router.get("/my-keys", verifyJWT, getMyLicenseKeys);
router.get("/:keyId/reveal", verifyJWT, revealLicenseKey);

export default router;

