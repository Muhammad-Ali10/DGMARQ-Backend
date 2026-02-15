import { Router } from "express";
import passport from "../config/passport.config.js";
import { 
  registerUser, 
  loginUser, 
  refreshAccessToken, 
  logoutUser, 
  getProfile,
  updatePassword, 
  updateProfile,
  googleOAuthCallback,
  facebookOAuth,
  facebookOAuthCallback,
  linkOAuthAccount,
  unlinkOAuthAccount,
  sendEmailVerification,
  verifyEmail,
  forgotPassword,
  resetPassword,
  changeEmail,
  verifyEmailChange,
  deleteAccount,
  getActiveSessions,
  revokeSession,
  revokeAllSessions,
} from "../controller/user.controller.js";
import { upload } from "../middlerwares/multer.middlerware.js";
import { verifyJWT, verifyJWTForLogout } from "../middlerwares/authmiddlerware.js";


const router = Router() 

import { apiLimiter, authLimiter, oauthLimiter, otpEmailLimiter } from "../middlerwares/rateLimit.middlerware.js";
import { validate, registerValidation, loginValidation } from "../middlerwares/validation.middlerware.js";

router.route("/register").post(
  apiLimiter,
  upload.single("profileImage"),
  validate(registerValidation),
  registerUser
) 
router.route("/login").post(
  authLimiter,
  validate(loginValidation),
  loginUser
)
router.route("/logout").post(verifyJWTForLogout, logoutUser)
router.route("/refresh-token").post(refreshAccessToken)
router.route("/profile").get(verifyJWT, getProfile)
router.route("/update-profile").patch(verifyJWT, upload.single("profileImage"), updateProfile)
router.route("/update-password").post(verifyJWT, updatePassword)

router.route("/auth/google").get(
  oauthLimiter,
  passport.authenticate('google', { 
    scope: ['profile', 'email']
  })
);

router.route("/auth/google/callback").get(
  oauthLimiter,
  passport.authenticate('google', { 
    session: false, 
    failureRedirect: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/login?error=oauth_failed` 
  }),
  googleOAuthCallback
);

router.route("/auth/facebook").get(
  oauthLimiter,
  passport.authenticate('facebook', { scope: ['email'] }),
  facebookOAuth
);

router.route("/auth/facebook/callback").get(
  oauthLimiter,
  passport.authenticate('facebook', { 
    session: false, 
    failureRedirect: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/login?error=oauth_failed` 
  }),
  facebookOAuthCallback
);

router.route("/link-oauth").post(verifyJWT, linkOAuthAccount)
router.route("/unlink-oauth").post(verifyJWT, unlinkOAuthAccount)

router.route("/send-verification").post(verifyJWT, otpEmailLimiter, sendEmailVerification)
router.route("/verify-email").post(verifyJWT, verifyEmail)

router.route("/forgot-password").post(forgotPassword)
router.route("/reset-password").post(resetPassword)

router.route("/change-email").post(verifyJWT, changeEmail)
router.route("/verify-email-change").post(verifyEmailChange)

router.route("/delete-account").post(verifyJWT, deleteAccount)

router.route("/sessions").get(verifyJWT, getActiveSessions)
router.route("/sessions/:sessionId/revoke").post(verifyJWT, revokeSession)
router.route("/sessions/revoke-all").post(verifyJWT, revokeAllSessions)

export default router
