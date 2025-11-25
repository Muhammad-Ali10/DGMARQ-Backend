import { Router } from "express";
import { verifyJWT, authorizeRoles } from "../middlerwares/authmiddlerware.js";
import { createReview, updateReview, deleteReview, getReviews } from "../controller/review.controller.js";

const router = Router();

router
  .route("/create-review")
  .post(verifyJWT, authorizeRoles("customer"), createReview);
router
  .route("/update-review/:id")
  .patch(verifyJWT, authorizeRoles("customer"), updateReview);
router
  .route("/delete-review/:id")
  .delete(verifyJWT, authorizeRoles("customer"), deleteReview);

router.route("/get-reviews").get(getReviews);


export default router;
