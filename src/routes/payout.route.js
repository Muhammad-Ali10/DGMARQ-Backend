import { Router } from "express";
import { verifyJWT, authorizeRoles } from "../middlerwares/authmiddlerware.js";
import {
  getMyPayouts,
  getPayoutDetails,
  getPayoutBalance,
  requestPayout,
  getPayoutRequests,
  updateMinimumPayoutThreshold,
  getPayoutReports,
} from "../controller/payout.controller.js";

const router = Router();

// IMPORTANT: Specific routes must come BEFORE parameterized routes (/:payoutId)
// Otherwise, routes like /reports will be matched as /:payoutId with payoutId="reports"

router
  .route("/my-payouts")
  .get(verifyJWT, authorizeRoles("seller"), getMyPayouts);

router
  .route("/balance")
  .get(verifyJWT, authorizeRoles("seller"), getPayoutBalance);

router
  .route("/request")
  .post(verifyJWT, authorizeRoles("seller"), requestPayout);

router
  .route("/requests")
  .get(verifyJWT, authorizeRoles("seller"), getPayoutRequests);

router
  .route("/minimum-threshold")
  .patch(verifyJWT, authorizeRoles("seller"), updateMinimumPayoutThreshold);

router
  .route("/reports")
  .get(verifyJWT, authorizeRoles("seller"), getPayoutReports);

// Parameterized route must come LAST
router
  .route("/:payoutId")
  .get(verifyJWT, authorizeRoles("seller"), getPayoutDetails);

export default router;

