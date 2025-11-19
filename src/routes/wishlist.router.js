import { Router } from "express";
import { verifyJWT, authorizeRoles } from "../middlerwares/authmiddlerware.js";
import { addToWishlist, getWishlist, removeFromWishlist, clearWishlist} from "../controller/wishlist.controller.js";

const router = Router();

router.route("/create-wishlist").post(verifyJWT, authorizeRoles("customer"), addToWishlist);
router.route("/get-wishlist").get(verifyJWT, authorizeRoles("customer"), getWishlist);
router.route("/remove-wishlist").patch(verifyJWT, authorizeRoles("customer"), removeFromWishlist);
router.route("/clear-wishlist").patch(verifyJWT, authorizeRoles("customer"), clearWishlist);

export default router;