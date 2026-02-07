import express from "express";
import { handlePayPalWebhook } from "../controller/webhook.controller.js";

// Purpose: Webhook routes for PayPal payment notifications

const router = express.Router();

router.options("/paypal", (req, res) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "POST, OPTIONS, GET");
  res.header("Access-Control-Allow-Headers", "Content-Type, X-PayPal-Webhook-Id");
  res.sendStatus(200);
});

router.get("/paypal", (req, res) => {
  res.status(200).json({
    ok: true,
    message: "PayPal webhook endpoint is active",
    endpoint: "/api/v1/webhook/paypal"
  });
});

router.post("/paypal", express.raw({ type: "application/json" }), handlePayPalWebhook);

export default router;
