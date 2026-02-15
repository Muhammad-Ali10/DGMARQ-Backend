import Router from "express";
import { 
  applySeller, 
  updateShopBanner, 
  updateShopLogo,
  updateSellerStatus, 
  getSellers, 
  checkSellerApplicationStatus,
  getSellerInfo,
  updateSellerProfile,
  getSellerWithdrawalHistory,
  getSellerPerformanceMetrics,
  getSellerVerificationBadge,
  getPublicSellerProfile,
  getSellerProducts,
  getSellerReviews,
} from "../controller/seller.controller.js";
import {
  getSellerLicenseKeys,
  deleteSellerLicenseKey,
  revealSellerLicenseKey,
} from "../controller/licensekey.controller.js";
import { verifyJWT, authorizeRoles } from "../middlerwares/authmiddlerware.js";
import { upload } from "../middlerwares/multer.middlerware.js";


const router = Router()

router.route("/apply-seller").post(
    verifyJWT,
    authorizeRoles("customer"),
    upload.fields([
        { name: "shopLogo", maxCount: 1 },
        { name: "shopBanner", maxCount: 1 },
        { name: "kycDocs", maxCount: 3 }
    ]),
    applySeller
)

router.route("/check-application-status").get(
    verifyJWT,
    authorizeRoles("customer"),
    checkSellerApplicationStatus
)
router.route("/update-shop-logo").patch(
    verifyJWT,
    authorizeRoles("seller"),
    upload.single("shopLogo"),
    updateShopLogo
)
router.route("/update-shop-banner").patch(
    verifyJWT,
    authorizeRoles("seller"),
    upload.single("shopBanner"),
    updateShopBanner
)
router.route("/update-seller-status/:sellerId").post(
    verifyJWT,
    authorizeRoles("admin"),
    updateSellerStatus
)
router.route("/get-sellers").get(
    verifyJWT,
    authorizeRoles("admin"),
    getSellers
)

router
    .route("/get-seller-info")
    .get(verifyJWT, authorizeRoles("seller"), getSellerInfo);

router
    .route("/update-profile")
    .patch(verifyJWT, authorizeRoles("seller"), updateSellerProfile);

router
    .route("/withdrawal-history")
    .get(verifyJWT, authorizeRoles("seller"), getSellerWithdrawalHistory);

router
    .route("/performance-metrics")
    .get(verifyJWT, authorizeRoles("seller"), getSellerPerformanceMetrics);

router
    .route("/verification-badge")
    .get(verifyJWT, authorizeRoles("seller"), getSellerVerificationBadge);

router
    .route("/public/:sellerId")
    .get(getPublicSellerProfile);

router
    .route("/:sellerId/products")
    .get(getSellerProducts);

router
    .route("/:sellerId/reviews")
    .get(getSellerReviews);

router
    .route("/license-keys/:keyId/reveal")
    .get(verifyJWT, authorizeRoles("seller"), revealSellerLicenseKey);

router
    .route("/license-keys/:keyId")
    .delete(verifyJWT, authorizeRoles("seller"), deleteSellerLicenseKey);

router
    .route("/license-keys/:productId")
    .get(verifyJWT, authorizeRoles("seller"), getSellerLicenseKeys);

export default router
