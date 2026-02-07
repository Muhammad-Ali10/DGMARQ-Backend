// Purpose: Checkout routes for creating sessions, handling payments, and processing order completion
import { Router } from "express";
import { verifyJWT, authorizeRoles, optionalJWT } from "../middlerwares/authmiddlerware.js";
import { checkoutLimiter } from "../middlerwares/rateLimit.middlerware.js";
import { validate, createCheckoutValidation, createGuestCheckoutValidation } from "../middlerwares/validation.middlerware.js";
import {
  createCheckoutSession,
  createGuestCheckoutSession,
  getCheckoutStatus,
  cancelCheckout,
  completeCheckout,
  getHandlingFeeEstimate,
} from "../controller/checkout.controller.js";
import { processWalletPayment } from "../controller/walletPayment.controller.js";

const router = Router();

router
  .route("/handling-fee-estimate")
  .get(verifyJWT, authorizeRoles("customer", "admin"), getHandlingFeeEstimate);

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
  .route("/guest/create")
  .post(
    checkoutLimiter,
    validate(createGuestCheckoutValidation),
    createGuestCheckoutSession
  );

router
  .route("/:checkoutId")
  .get(optionalJWT, getCheckoutStatus);

router
  .route("/:checkoutId/cancel")
  .post(optionalJWT, cancelCheckout);

router
  .route("/:checkoutId/pay-with-wallet")
  .post(verifyJWT, authorizeRoles("customer", "admin"), processWalletPayment);

router.route("/complete").post(completeCheckout);

export default router;

