import { Router } from "express";
import { verifyJWT, authorizeRoles } from "../middlerwares/authmiddlerware.js";
import { checkoutLimiter } from "../middlerwares/rateLimit.middlerware.js";
import { validate, createCheckoutValidation } from "../middlerwares/validation.middlerware.js";
import {
  createCheckoutSession,
  getCheckoutStatus,
  cancelCheckout,
  completeCheckout,
} from "../controller/checkout.controller.js";

const router = Router();

router
  .route("/create")
  .post(
    checkoutLimiter,
    verifyJWT,
    authorizeRoles("customer", "admin"),
    validate(createCheckoutValidation),
    createCheckoutSession
  );

router
  .route("/:checkoutId")
  .get(verifyJWT, authorizeRoles("customer", "admin"), getCheckoutStatus);

router
  .route("/:checkoutId/cancel")
  .post(verifyJWT, authorizeRoles("customer", "admin"), cancelCheckout);

// Webhook endpoint (no auth required, verified by PayPal signature)
router.route("/complete").post(completeCheckout);

// NOTE: Card payment endpoint removed for security
// Card payments must use PayPal-hosted CardFields via /api/v1/paypal/orders

export default router;

