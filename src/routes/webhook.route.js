import express from "express";
import { handlePayPalWebhook } from "../controller/webhook.controller.js";

const router = express.Router();

// FIX: PayPal webhook endpoint - MUST use express.raw() to preserve raw body for signature verification
// Signature verification requires the raw request body (not parsed JSON)
// No auth required - security is handled via PayPal webhook signature verification using PAYPAL_WEBHOOK_ID
router.post("/paypal", express.raw({ type: "application/json" }), handlePayPalWebhook);

export default router;

