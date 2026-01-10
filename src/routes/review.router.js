import { Router } from "express";
import { verifyJWT, authorizeRoles } from "../middlerwares/authmiddlerware.js";
import { validate, createReviewValidation } from "../middlerwares/validation.middlerware.js";
import { upload } from "../middlerwares/multer.middlerware.js";
import { 
  createReview, 
  updateReview, 
  deleteReview, 
  getReviews,
  voteOnReview,
  replyToReview,
  getReviewReplies,
  addReviewPhoto,
  getReviewPhotos,
  moderateReview,
} from "../controller/review.controller.js";

const router = Router();

router
  .route("/create-review")
  .post(
    verifyJWT,
    authorizeRoles("customer"),
    validate(createReviewValidation),
    createReview
  );
router
  .route("/update-review/:id")
  .patch(verifyJWT, authorizeRoles("customer"), updateReview);
router
  .route("/delete-review/:id")
  .delete(verifyJWT, authorizeRoles("customer"), deleteReview);

router.route("/get-reviews").get(getReviews);

router.route("/:reviewId/vote").post(verifyJWT, voteOnReview);
router.route("/:reviewId/reply").post(verifyJWT, replyToReview);
router.route("/:reviewId/replies").get(getReviewReplies);
router.route("/:reviewId/photos").post(verifyJWT, upload.single("photo"), addReviewPhoto);
router.route("/:reviewId/photos").get(getReviewPhotos);
router.route("/:reviewId/moderate").post(verifyJWT, authorizeRoles("admin"), moderateReview);

export default router;
