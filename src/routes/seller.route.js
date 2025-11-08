import Router from "express";
import { applySeller, updateShopBanner, updateShopLogo,updateSellerStatus, getSellers, getSellerInfo } from "../controller/seller.controller.js";
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
    


export default router
