import express from "express";
import { handlePayPalWebhook } from "../controller/webhook.controller.js";

const router = express.Router();

// Handle OPTIONS request for CORS preflight (PayPal webhook verification)
router.options("/paypal", (req, res) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "POST, OPTIONS, GET");
  res.header("Access-Control-Allow-Headers", "Content-Type, X-PayPal-Webhook-Id");
  res.sendStatus(200);
});

// GET endpoint for PayPal webhook URL verification (returns 200 to confirm endpoint exists)
router.get("/paypal", (req, res) => {
  res.status(200).json({
    ok: true,
    message: "PayPal webhook endpoint is active",
    endpoint: "/api/v1/webhook/paypal"
  });
});

// FIX: PayPal webhook endpoint - MUST use express.raw() to preserve raw body for signature verification
// Signature verification requires the raw request body (not parsed JSON)
// No auth required - security is handled via PayPal webhook signature verification using PAYPAL_WEBHOOK_ID
router.post("/paypal", express.raw({ type: "application/json" }), handlePayPalWebhook);

export default router;

