import { User } from "../models/user.model.js"
import { Session } from "../models/session.model.js"
import { asyncHandler } from "../utils/asyncHandler.js"
import { ApiError } from "../utils/ApiError.js"
import { ApiResponse } from "../utils/ApiResponse.js"
import bcrypt from "bcrypt";
import { fileUploader } from "../utils/cloudinary.js";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import crypto from "crypto";
import { sendPasswordResetEmail, sendEmailVerificationOTP } from "../services/email.service.js";
import nodemailer from "nodemailer";



// Purpose: Generates access and refresh tokens for a user and stores the hashed refresh token
const generateRefreshTokenAndAccessToken = async (userid) => {

    const user = await User.findById(userid).select('-password -refreshToken')

    const accessToken = await user.generateAccessToken(user?._id)

    const refreshToken = await user.generateRefreshToken(user?._id)

    const bcryptRefreshToken = await bcrypt.hash(refreshToken, 10)

    user.refreshToken = bcryptRefreshToken

    user.save({
        validateBeforeSave: true
    })

    return { accessToken, refreshToken }
}



// Purpose: Registers a new user with optional profile image upload
const registerUser = asyncHandler(async (req, res) => {

    const { name, email, password, roles } = req.body

    if (!name || !email || !password) {
        throw new ApiError(409, "All fields are required")
    }

    let profileImageUrl = null;
    if (req.file && req.file.path) {
        const profileImagePath = await fileUploader(req.file.path)

        if (!profileImagePath) {
            throw new ApiError(500, "Some Thing Went Wrong")
        }
        profileImageUrl = profileImagePath.url;
    }

    const existingUser = await User.findOne({ email })

    if (existingUser) {
        throw new ApiError(409, "User already exists")
    }

    const user = await User.create({
        name,
        email,
        password,
        roles,
        profileImage: profileImageUrl
    })

    if (!user) {
        throw new ApiError(404, "User not created")
    }

    return res.status(201).json(new ApiResponse(201, user, "User created successfully"))

})


// Purpose: Authenticates user and returns access/refresh tokens with seller information
const loginUser = asyncHandler(async (req, res) => {

    const { email, password } = req.body

    if (!email || !password) {
        throw new ApiError(409, "All the feild requried")
    }

    const user = await User.findOne({ email })

    if (!user) {
        throw new ApiError(404, "User not Found")
    }

    const isPasswordValidate = await user.isPasswordCorrect(password)

    if (!isPasswordValidate) {
        throw new ApiError(401, "Password Wrong")
    }

    const { accessToken, refreshToken } = await generateRefreshTokenAndAccessToken(user._id)



    const userAsSeller = await User.aggregate([
        {
            $match: {
                _id: new mongoose.Types.ObjectId(user._id)
            }
        },
        {
            $lookup: {
                from: "sellers",
                localField: "_id",
                foreignField: "userId",
                as: "seller"
            }
        },
        {
            $unwind: {
                path: "$seller",
                preserveNullAndEmptyArrays: true
            }
        },
        {
            $project: {
                name: 1,
                email: 1,
                roles: 1,
                profileImage: 1,
                seller: {
                    _id: "$seller._id",
                    shopName: "$seller.shopName",
                    shopLogo: "$seller.shopLogo",
                    shopBanner: "$seller.shopBanner",
                    description: "$seller.description",
                    country: "$seller.country",
                    state: "$seller.state",
                    city: "$seller.city",
                    payoutAccount: "$seller.payoutAccount",
                    kycDocs: "$seller.kycDocs",
                    rating: "$seller.rating",
                    status: "$seller.status",
                    minPayoutAmount: "$seller.minPayoutAmount",
                    payoutAutoRelease: "$seller.payoutAutoRelease"
                }
            }
        }
    ]);

    const userData = userAsSeller && userAsSeller.length > 0 ? userAsSeller[0] : null;

    if (!userData) {
        throw new ApiError(500, "Failed to retrieve user data");
    }

    const opition = {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
    }

    res.status(200)
        .cookie("accessToken", accessToken, opition)
        .cookie("refreshToken", refreshToken, opition)
        .json(
            new ApiResponse(200, {
                user: userData,
                accessToken,
                refreshToken
            }, "User logged in successfully")
        )

})


// Purpose: Refreshes access token using a valid refresh token
const refreshAccessToken = asyncHandler(async (req, res) => {

    const incomingRefreshToken = (req.cookies?.refreshToken) || (req.body?.refreshToken);

    if (!incomingRefreshToken) {
        throw new ApiError(401, "unauthorize")
    }

    try {

        const decoded = jwt.verify(incomingRefreshToken, process.env.REFRESH_TOKEN_SECRET)
        const user = await User.findById(decoded._id)
        if (!user) {
            throw new ApiError(404, "User not found")
        }

        const isRefreshTokenValid = await bcrypt.compare(incomingRefreshToken, user.refreshToken)

        if (!isRefreshTokenValid) {
            throw new ApiError(401, "unauthorize")
        }

        const { accessToken, refreshToken } = await generateRefreshTokenAndAccessToken(user._id)

        const opition = {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
        }
        res.status(200)
            .cookie("accessToken", accessToken, opition)
            .cookie("refreshToken", refreshToken, opition)
            .json(
                new ApiResponse(200, {
                    refreshToken,
                    accessToken
                }, "Refersh Token successfully")
            )

    } catch (error) {
        throw new ApiError(401, "unauthorize")
    }

})


// Purpose: Logs out user by clearing refresh token and cookies
const logoutUser = asyncHandler(async (req, res) => {

    if (req.user && req.user._id) {
        const user = await User.findById(req.user._id)

        if (user) {
            user.refreshToken = undefined
            await user.save({
                validateBeforeSave: true
            })
        }
    }

    const opition = {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
    }

    res.status(200)
        .cookie("accessToken", "", { ...opition, maxAge: 0 })
        .cookie("refreshToken", "", { ...opition, maxAge: 0 })
        .json(
            new ApiResponse(200, {}, "User logged out successfully")
        )

})


// Purpose: Retrieves user profile excluding sensitive fields
const getProfile = asyncHandler(async (req, res) => {
    const user = await User.findById(req.user._id).select('-password -refreshToken -emailVerificationOTP -emailVerificationToken -passwordResetToken').lean()

    if (!user) {
        throw new ApiError(404, "User not found")
    }

    res.status(200).json(new ApiResponse(200, user, "Profile retrieved successfully"))
})

// Purpose: Updates user profile including optional profile image and name
const updateProfile = asyncHandler(async (req, res) => {

    const user = await User.findById(req.user._id)

    if (!user) {
        throw new ApiError(404, "User not found")
    }

    if (req.file && req.file.path) {
        const profileImagePath = await fileUploader(req.file.path)

        if (!profileImagePath) {
            throw new ApiError(500, "Something went wrong with image upload")
        }

        user.profileImage = profileImagePath.url
    }

    const { name } = req.body;
    if (name) {
        user.name = name;
    }

    await user.save({
        validateBeforeSave: true
    })

    res.status(200).json(new ApiResponse(200, user, "Profile updated successfully"))

})


// Purpose: Updates user password after validating old password
const updatePassword = asyncHandler(async (req, res) => {

    const { oldPassword, newPassword } = req.body
    const user = await User.findById(req.user._id)

    if (!user) {
        throw new ApiError(404, "User not found")
    }
    const isPasswordCorrect = await user.isPasswordCorrect(oldPassword)

    if (!isPasswordCorrect) {
        throw new ApiError(401, "Password wrong")
    }
    user.password = newPassword

    await user.save({
        validateBeforeSave: true
    })

    res.status(200).json(new ApiResponse(200, user, "Password updated successfully"))

})


// Purpose: Initiates Google OAuth authentication flow
const googleOAuth = asyncHandler(async (req, res, next) => {
  next();
});

// Purpose: Handles Google OAuth callback and redirects with tokens
const googleOAuthCallback = asyncHandler(async (req, res) => {
  const user = req.user;

  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
  
  if (!user) {
    return res.redirect(`${frontendUrl}/login?error=oauth_failed`);
  }

  const { accessToken, refreshToken } = await generateRefreshTokenAndAccessToken(user._id);

  user.lastLogin = new Date();
  user.loginCount = (user.loginCount || 0) + 1;
  await user.save();

  const redirectUrl = `${frontendUrl}/auth/callback?token=${accessToken}&refreshToken=${refreshToken}`;
  return res.redirect(redirectUrl);
});

// Purpose: Initiates Facebook OAuth authentication flow
const facebookOAuth = asyncHandler(async (req, res, next) => {
  next();
});

// Purpose: Handles Facebook OAuth callback and redirects with tokens
const facebookOAuthCallback = asyncHandler(async (req, res) => {
  const user = req.user;

  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';

  if (!user) {
    return res.redirect(`${frontendUrl}/login?error=oauth_failed`);
  }

  const { accessToken, refreshToken } = await generateRefreshTokenAndAccessToken(user._id);

  user.lastLogin = new Date();
  user.loginCount = (user.loginCount || 0) + 1;
  await user.save();

  const redirectUrl = `${frontendUrl}/auth/callback?token=${accessToken}&refreshToken=${refreshToken}`;
  return res.redirect(redirectUrl);
});

// Purpose: Links an OAuth account to the current user account
const linkOAuthAccount = asyncHandler(async (req, res) => {
  const userId = req.user._id;
  const { provider, oauthId } = req.body;

  if (!provider || !oauthId) {
    throw new ApiError(400, 'Provider and OAuth ID are required');
  }

  if (!['google', 'facebook'].includes(provider)) {
    throw new ApiError(400, 'Invalid OAuth provider');
  }

  const user = await User.findById(userId);
  if (!user) {
    throw new ApiError(404, 'User not found');
  }

  const existingUser = await User.findOne({ oauthId, oauthProvider: provider });
  if (existingUser && existingUser._id.toString() !== userId.toString()) {
    throw new ApiError(409, 'This OAuth account is already linked to another user');
  }

  user.oauthProvider = provider;
  user.oauthId = oauthId;
  await user.save();

  return res.status(200).json(
    new ApiResponse(200, user, `${provider} account linked successfully`)
  );
});

// Purpose: Unlinks an OAuth account from the user account
const unlinkOAuthAccount = asyncHandler(async (req, res) => {
  const userId = req.user._id;
  const { provider } = req.body;

  if (!provider) {
    throw new ApiError(400, 'Provider is required');
  }

  const user = await User.findById(userId);
  if (!user) {
    throw new ApiError(404, 'User not found');
  }

  if (user.oauthProvider === provider && !user.password) {
    throw new ApiError(400, 'Cannot unlink OAuth account. Please set a password first.');
  }

  if (user.oauthProvider === provider) {
    user.oauthProvider = 'local';
    user.oauthId = undefined;
    await user.save();
  }

  return res.status(200).json(
    new ApiResponse(200, user, `${provider} account unlinked successfully`)
  );
});

// Purpose: Sends email verification OTP to user's email address
const sendEmailVerification = asyncHandler(async (req, res) => {
  const userId = req.user._id;
  const user = await User.findById(userId);

  if (!user) {
    throw new ApiError(404, "User not found");
  }

  if (user.emailVerified) {
    throw new ApiError(400, "Email already verified");
  }

  if (user.emailVerificationOTP && user.emailVerificationOTPExpires && user.emailVerificationOTPExpires > new Date()) {
    const remainingTime = Math.ceil((user.emailVerificationOTPExpires - new Date()) / 1000 / 60);
    throw new ApiError(429, `Please wait ${remainingTime} minute(s) before requesting a new OTP`);
  }

  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  
  user.emailVerificationOTP = otp;
  user.emailVerificationOTPExpires = new Date(Date.now() + 10 * 60 * 1000);
  await user.save();

  await sendEmailVerificationOTP(user, otp);

  return res.status(200).json(
    new ApiResponse(200, null, "Verification OTP sent successfully to your email")
  );
});

// Purpose: Verifies user email using the provided OTP
const verifyEmail = asyncHandler(async (req, res) => {
  const { otp } = req.body;
  const userId = req.user._id;

  if (!otp) {
    throw new ApiError(400, "OTP is required");
  }

  if (!/^\d{6}$/.test(otp)) {
    throw new ApiError(400, "Invalid OTP format. OTP must be 6 digits");
  }

  const user = await User.findById(userId);

  if (!user) {
    throw new ApiError(404, "User not found");
  }

  if (!user.emailVerificationOTP || user.emailVerificationOTP !== otp) {
    throw new ApiError(400, "Invalid OTP");
  }

  if (!user.emailVerificationOTPExpires || user.emailVerificationOTPExpires <= new Date()) {
    throw new ApiError(400, "OTP has expired. Please request a new one");
  }

  user.emailVerified = true;
  user.emailVerificationOTP = undefined;
  user.emailVerificationOTPExpires = undefined;
  user.emailVerificationToken = undefined;
  user.emailVerificationExpires = undefined;
  await user.save();

  return res.status(200).json(
    new ApiResponse(200, { emailVerified: true }, "Email verified successfully")
  );
});

// Purpose: Initiates password reset process by sending reset email
const forgotPassword = asyncHandler(async (req, res) => {
  const { email } = req.body;

  if (!email) {
    throw new ApiError(400, "Email is required");
  }

  const user = await User.findOne({ email });

  if (!user) {
    return res.status(200).json(
      new ApiResponse(200, null, "If email exists, password reset link has been sent")
    );
  }

  const resetToken = crypto.randomBytes(32).toString("hex");
  user.passwordResetToken = resetToken;
  user.passwordResetExpires = new Date(Date.now() + 3600000);
  await user.save();

  await sendPasswordResetEmail(user, resetToken);

  return res.status(200).json(
    new ApiResponse(200, null, "If email exists, password reset link has been sent")
  );
});

// Purpose: Resets user password using a valid reset token
const resetPassword = asyncHandler(async (req, res) => {
  const { token, newPassword } = req.body;

  if (!token || !newPassword) {
    throw new ApiError(400, "Token and new password are required");
  }

  if (newPassword.length < 6) {
    throw new ApiError(400, "Password must be at least 6 characters");
  }

  const user = await User.findOne({
    passwordResetToken: token,
    passwordResetExpires: { $gt: new Date() },
  });

  if (!user) {
    throw new ApiError(400, "Invalid or expired reset token");
  }

  user.password = newPassword;
  user.passwordResetToken = undefined;
  user.passwordResetExpires = undefined;
  await user.save();

  return res.status(200).json(
    new ApiResponse(200, null, "Password reset successfully")
  );
});

// Purpose: Initiates email change process by sending verification email to new address
const changeEmail = asyncHandler(async (req, res) => {
  const userId = req.user._id;
  const { newEmail, password } = req.body;

  if (!newEmail || !password) {
    throw new ApiError(400, "New email and password are required");
  }

  const user = await User.findById(userId);

  if (!user) {
    throw new ApiError(404, "User not found");
  }

  const isPasswordCorrect = await user.isPasswordCorrect(password);

  if (!isPasswordCorrect) {
    throw new ApiError(401, "Incorrect password");
  }

  const existingUser = await User.findOne({ email: newEmail });

  if (existingUser) {
    throw new ApiError(409, "Email already in use");
  }

  const verificationToken = crypto.randomBytes(32).toString("hex");
  user.emailVerificationToken = verificationToken;
  user.emailVerificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000);
  user.pendingEmail = newEmail;
  await user.save();

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || "587"),
    secure: process.env.SMTP_SECURE === "true",
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });

  const verifyUrl = `${process.env.FRONTEND_URL}/verify-email-change?token=${verificationToken}`;
  await transporter.sendMail({
    from: process.env.EMAIL_FROM || "noreply@dgmarq.com",
    to: newEmail,
    subject: "Verify Your New Email Address",
    html: `
      <h2>Verify Your New Email Address</h2>
      <p>Hello ${user.name},</p>
      <p>You requested to change your email to ${newEmail}.</p>
      <p>Click to verify: <a href="${verifyUrl}">Verify New Email</a></p>
      <p>This link expires in 24 hours.</p>
    `,
  });

  return res.status(200).json(
    new ApiResponse(200, null, "Verification email sent to new address")
  );
});

// Purpose: Verifies and completes email change using verification token
const verifyEmailChange = asyncHandler(async (req, res) => {
  const { token } = req.body;

  if (!token) {
    throw new ApiError(400, "Verification token is required");
  }

  const user = await User.findOne({
    emailVerificationToken: token,
    emailVerificationExpires: { $gt: new Date() },
  });

  if (!user || !user.pendingEmail) {
    throw new ApiError(400, "Invalid or expired verification token");
  }

  const existingUser = await User.findOne({ email: user.pendingEmail });

  if (existingUser) {
    throw new ApiError(409, "Email is no longer available");
  }

  user.email = user.pendingEmail;
  user.pendingEmail = undefined;
  user.emailVerificationToken = undefined;
  user.emailVerificationExpires = undefined;
  user.emailVerified = true;
  await user.save();

  return res.status(200).json(
    new ApiResponse(200, { email: user.email }, "Email changed successfully")
  );
});

// Purpose: Deletes user account after password verification and deactivates all sessions
const deleteAccount = asyncHandler(async (req, res) => {
  const userId = req.user._id;
  const { password } = req.body;

  if (!password) {
    throw new ApiError(400, "Password is required for account deletion");
  }

  const user = await User.findById(userId);

  if (!user) {
    throw new ApiError(404, "User not found");
  }

  const isPasswordCorrect = await user.isPasswordCorrect(password);

  if (!isPasswordCorrect) {
    throw new ApiError(401, "Incorrect password");
  }

  user.isActive = false;
  await user.save();

  await Session.updateMany({ userId, isActive: true }, { isActive: false });

  return res.status(200).json(
    new ApiResponse(200, null, "Account deleted successfully")
  );
});

// Purpose: Retrieves all active sessions for the current user
const getActiveSessions = asyncHandler(async (req, res) => {
  const userId = req.user._id;

  const sessions = await Session.find({
    userId,
    isActive: true,
    expiresAt: { $gt: new Date() },
  }).sort({ lastActivity: -1 });

  return res.status(200).json(
    new ApiResponse(200, sessions, "Active sessions retrieved successfully")
  );
});

// Purpose: Revokes a specific user session by session ID
const revokeSession = asyncHandler(async (req, res) => {
  const userId = req.user._id;
  const { sessionId } = req.params;

  if (!mongoose.Types.ObjectId.isValid(sessionId)) {
    throw new ApiError(400, "Invalid session ID");
  }

  const session = await Session.findOne({ _id: sessionId, userId });

  if (!session) {
    throw new ApiError(404, "Session not found");
  }

  session.isActive = false;
  await session.save();

  return res.status(200).json(
    new ApiResponse(200, null, "Session revoked successfully")
  );
});

// Purpose: Revokes all active sessions for the current user
const revokeAllSessions = asyncHandler(async (req, res) => {
  const userId = req.user._id;

  await Session.updateMany({ userId, isActive: true }, { isActive: false });

  return res.status(200).json(
    new ApiResponse(200, null, "All sessions revoked successfully")
  );
});

export { 
  generateRefreshTokenAndAccessToken,
  registerUser, 
  loginUser, 
  refreshAccessToken, 
  logoutUser,
  getProfile,
  updateProfile, 
  updatePassword,
  googleOAuth,
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
}