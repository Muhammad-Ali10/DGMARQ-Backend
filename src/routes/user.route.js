import { Router } from "express";
import { registerUser, loginUser, refershAccessToken, logoutUser, updatePassword, updateProfile } from "../controller/user.controller.js"
import { upload } from "../middlerwares/multer.middlerware.js";

const router = Router() 

router.route("/register").post(upload.single("profileImage"), registerUser)
router.route("/login").post(loginUser)
router.route("/logout").post(logoutUser)
router.route("/refersh-token").post(refershAccessToken)
router.route("/update-profile").patch(upload.single("profileImage"), updateProfile)
router.route("/update-password").post(updatePassword)

export default router