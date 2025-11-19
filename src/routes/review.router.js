import { Router } from "express";
import { verifyJWT, authorizeRoles } from "../middlerwares/authmiddlerware.js";
import { createReview } from "../controller/review.controller.js";

const router = Router();

router
  .route("/create-review")
  .post(verifyJWT, authorizeRoles("customer"), createReview);

export default router;
