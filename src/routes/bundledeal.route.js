import { Router } from "express";
import { verifyJWT, authorizeRoles } from "../middlerwares/authmiddlerware.js";
import { upload } from "../middlerwares/multer.middlerware.js";
import {
  createBundleDeal,
  getAllBundleDeals,
  getActiveBundleDeals,
  getBundleDealById,
  updateBundleDeal,
  deleteBundleDeal,
  toggleBundleDealStatus,
} from "../controller/bundledeal.controller.js";

const router = Router();

router.route("/active").get(getActiveBundleDeals);

router.use(verifyJWT, authorizeRoles("admin"));

router.route("/").post(upload.single("bannerImage"), createBundleDeal);
router.route("/").get(getAllBundleDeals);
router.route("/:id").patch(upload.single("bannerImage"), updateBundleDeal);
router.route("/:id").delete(deleteBundleDeal);
router.route("/:id/toggle-status").patch(toggleBundleDealStatus);

router.route("/:identifier").get(getBundleDealById);

export default router;

