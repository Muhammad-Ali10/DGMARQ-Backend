import mongoose from "mongoose";
import crypto from "crypto";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { SellerPayoutAccount } from "../models/sellerPayoutAccount.model.js";
import { Seller } from "../models/seller.model.js";
import { User } from "../models/user.model.js";
import { createNotification } from "../services/notification.service.js";
import { auditLog } from "../services/audit.service.js";
import { encryptKey, decryptKey } from "../utils/encryption.js";
import {
  getPayPalOAuthAuthorizeUrl,
  exchangePayPalOAuthCode,
  getPayPalUserInfo,
} from "../services/payment.service.js";

const PAYPAL_CONNECT_STATE_TTL_MS = 10 * 60 * 1000;

function createPayPalConnectState(sellerId) {
  const secret = process.env.ACCESS_TOKEN_SECRET || process.env.ENCRYPTION_KEY || "paypal-connect-secret";
  const payload = `${sellerId}.${Date.now()}`;
  const hmac = crypto.createHmac("sha256", secret).update(payload).digest("hex");
  return Buffer.from(`${payload}.${hmac}`).toString("base64url");
}

function verifyPayPalConnectState(state) {
  if (!state || typeof state !== "string") return null;
  const secret = process.env.ACCESS_TOKEN_SECRET || process.env.ENCRYPTION_KEY || "paypal-connect-secret";
  let payload;
  try {
    payload = Buffer.from(state, "base64url").toString("utf8");
  } catch {
    return null;
  }
  const parts = payload.split(".");
  if (parts.length !== 3) return null;
  const [sellerId, tsStr, hmac] = parts;
  const expectedHmac = crypto.createHmac("sha256", secret).update(`${sellerId}.${tsStr}`).digest("hex");
  if (crypto.timingSafeEqual(Buffer.from(hmac, "hex"), Buffer.from(expectedHmac, "hex")) !== true) return null;
  const ts = parseInt(tsStr, 10);
  if (Number.isNaN(ts) || Date.now() - ts > PAYPAL_CONNECT_STATE_TTL_MS) return null;
  return sellerId;
}

const getPayPalConnectUrl = asyncHandler(async (req, res) => {
  const userId = req.user._id;
  const seller = await Seller.findOne({ userId });
  if (!seller) {
    throw new ApiError(404, "Seller profile not found");
  }
  const baseUrl =
    process.env.BACKEND_URL ||
    process.env.BASE_URL ||
    `${req.protocol}://${req.get("host")}`;
  const redirectUri = `${baseUrl}/api/v1/payout-account/paypal/callback`;
  const state = createPayPalConnectState(seller._id.toString());
  const url = getPayPalOAuthAuthorizeUrl(state, redirectUri);
  return res.status(200).json(
    new ApiResponse(200, { url, state }, "PayPal connect URL generated")
  );
});

const paypalOAuthCallback = asyncHandler(async (req, res) => {
  const { code, state } = req.query;
  const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";
  const successRedirect = `${frontendUrl}/seller/payout-account?paypal=success`;
  const errorRedirect = `${frontendUrl}/seller/payout-account?paypal=error`;

  if (!code || !state) {
    return res.redirect(`${errorRedirect}&reason=missing_params`);
  }

  const sellerId = verifyPayPalConnectState(state);
  if (!sellerId) {
    return res.redirect(`${errorRedirect}&reason=invalid_state`);
  }

  const seller = await Seller.findById(sellerId);
  if (!seller) {
    return res.redirect(`${errorRedirect}&reason=seller_not_found`);
  }

  const baseUrl =
    process.env.BACKEND_URL ||
    process.env.BASE_URL ||
    `${req.protocol}://${req.get("host")}`;
  const redirectUri = `${baseUrl}/api/v1/payout-account/paypal/callback`;

  let tokenData;
  try {
    tokenData = await exchangePayPalOAuthCode(code, redirectUri);
  } catch (err) {
    return res.redirect(`${errorRedirect}&reason=oauth_failed`);
  }

  let userInfo;
  try {
    userInfo = await getPayPalUserInfo(tokenData.access_token);
  } catch (err) {
    return res.redirect(`${errorRedirect}&reason=userinfo_failed`);
  }

  const {
    paypalMerchantId,
    paypalEmail,
    accountStatus,
    paymentsReceivable,
  } = userInfo;

  const accountStatusNormalized = (accountStatus || "").toLowerCase();
  const isVerified =
    paymentsReceivable === true &&
    (accountStatusNormalized === "verified");

  seller.paypalMerchantId = paypalMerchantId || null;
  seller.paypalEmail = paypalEmail || null;
  seller.paypalOAuthConnected = true;
  seller.paymentsReceivable = paymentsReceivable === true;
  seller.accountStatus = accountStatusNormalized || "unverified";
  seller.oauthConnectedAt = new Date();
  seller.paypalVerified = isVerified;
  seller.payoutAccount = paypalEmail || "paypal-connected";
  await seller.save();

  let payoutAccount = await SellerPayoutAccount.findOne({ sellerId: seller._id });
  const encryptedEmail = encryptKey(paypalEmail || "");
  if (payoutAccount) {
    payoutAccount.accountType = "paypal";
    payoutAccount.accountIdentifier = paypalEmail || paypalMerchantId || "";
    payoutAccount.encryptedAccountIdentifier = encryptedEmail;
    payoutAccount.provider = "paypal";
    payoutAccount.status = isVerified ? "verified" : "pending";
    payoutAccount.verifiedAt = isVerified ? new Date() : null;
    payoutAccount.verifiedBy = null;
    payoutAccount.linkedAt = new Date();
    await payoutAccount.save();
  } else {
    payoutAccount = await SellerPayoutAccount.create({
      sellerId: seller._id,
      accountType: "paypal",
      accountIdentifier: paypalEmail || paypalMerchantId || "",
      encryptedAccountIdentifier: encryptedEmail,
      provider: "paypal",
      status: isVerified ? "verified" : "pending",
      verifiedAt: isVerified ? new Date() : null,
      linkedAt: new Date(),
    });
  }

  const sellerUser = await User.findById(seller.userId);
  await auditLog(seller.userId, "PAYOUT_ACCOUNT_PAYPAL_OAUTH", "PayPal connected via OAuth", {
    sellerId: seller._id,
    paypalMerchantId,
    paypalVerified: isVerified,
  });

  if (sellerUser) {
    await createNotification(
      sellerUser._id,
      "payout",
      isVerified ? "PayPal account connected and verified" : "PayPal account connected – verification pending",
      isVerified
        ? "Your PayPal account is connected and verified. You can receive payouts."
        : "Your PayPal account is connected. Some account features may be limited until fully verified.",
      { sellerId: seller._id },
      "/seller/payout-account"
    );
  }

  return res.redirect(successRedirect);
});

const linkPayoutAccount = asyncHandler(async (req, res) => {
  const { accountType } = req.body || {};

  if (accountType === "paypal") {
    throw new ApiError(
      400,
      "PayPal cannot be linked by email. Please use 'Connect PayPal' to sign in with your PayPal account. Email-only accounts are not accepted for payouts."
    );
  }

  throw new ApiError(400, "Only PayPal is supported. Please use 'Connect PayPal' to link your account.");
});

const getMyPayoutAccount = asyncHandler(async (req, res) => {
  const userId = req.user._id;

  const seller = await Seller.findOne({ userId });
  if (!seller) {
    throw new ApiError(404, "Seller profile not found");
  }

  const payoutAccount = await SellerPayoutAccount.findOne({ sellerId: seller._id });

  const hasAccount = seller.paypalOAuthConnected || !!payoutAccount;
  const payoutEligible =
    seller.paypalVerified === true &&
    seller.accountBlocked !== true &&
    seller.paypalOAuthConnected === true;

  if (!hasAccount) {
    return res.status(200).json(
      new ApiResponse(200, {
        hasAccount: false,
        paypalOAuthConnected: false,
        paypalVerified: false,
        accountBlocked: !!seller.accountBlocked,
        payoutEligible: false,
        message: "Connect your PayPal account to receive payouts. Email-only accounts are not accepted.",
      }, "No payout account found")
    );
  }

  const maskedAccount = payoutAccount
    ? {
        ...payoutAccount.toObject(),
        accountIdentifier: maskAccountIdentifier(payoutAccount.accountIdentifier, payoutAccount.accountType || payoutAccount.provider),
        encryptedAccountIdentifier: undefined,
      }
    : null;

  return res.status(200).json(
    new ApiResponse(200, {
      hasAccount: true,
      paypalOAuthConnected: !!seller.paypalOAuthConnected,
      paypalVerified: !!seller.paypalVerified,
      accountBlocked: !!seller.accountBlocked,
      payoutEligible,
      accountStatus: seller.accountStatus || null,
      paymentsReceivable: seller.paymentsReceivable,
      oauthConnectedAt: seller.oauthConnectedAt || null,
      paypalEmail: seller.paypalEmail ? maskAccountIdentifier(seller.paypalEmail, "paypal") : null,
      payoutAccount: maskedAccount,
    }, "Payout account retrieved successfully")
  );
});

const verifyPayoutAccount = asyncHandler(async (req, res) => {
  const adminId = req.user._id;
  const { accountId } = req.params;

  if (!mongoose.Types.ObjectId.isValid(accountId)) {
    throw new ApiError(400, "Invalid account ID");
  }

  const payoutAccount = await SellerPayoutAccount.findById(accountId).populate("sellerId");
  if (!payoutAccount) {
    throw new ApiError(404, "Payout account not found");
  }

  if (payoutAccount.status === 'verified') {
    throw new ApiError(400, "Account is already verified");
  }

  payoutAccount.status = 'verified';
  payoutAccount.verifiedAt = new Date();
  payoutAccount.verifiedBy = adminId;
  await payoutAccount.save();

  const sellerUser = await User.findById(payoutAccount.sellerId.userId);
  if (sellerUser) {
    await createNotification(
      sellerUser._id,
      "payout",
      "Payout Account Verified",
      "Your payout account has been verified. You can now receive payouts.",
      { accountId: payoutAccount._id },
      "/seller/payout-account"
    );
  }

  await auditLog(adminId, "PAYOUT_ACCOUNT_VERIFIED", `Verified payout account ${accountId}`, {
    accountId: payoutAccount._id,
    sellerId: payoutAccount.sellerId._id,
  });

  return res.status(200).json(
    new ApiResponse(200, payoutAccount, "Payout account verified successfully")
  );
});

const blockPayoutAccount = asyncHandler(async (req, res) => {
  const adminId = req.user._id;
  const { accountId } = req.params;
  const { isBlocked, blockReason } = req.body;

  if (!mongoose.Types.ObjectId.isValid(accountId)) {
    throw new ApiError(400, "Invalid account ID");
  }

  if (typeof isBlocked !== "boolean") {
    throw new ApiError(400, "isBlocked must be a boolean");
  }

  const payoutAccount = await SellerPayoutAccount.findById(accountId).populate("sellerId");
  if (!payoutAccount) {
    throw new ApiError(404, "Payout account not found");
  }

  if (isBlocked) {
    payoutAccount.status = 'blocked';
    payoutAccount.blockedAt = new Date();
    payoutAccount.blockedBy = adminId;
    payoutAccount.blockedReason = blockReason || "Blocked by admin";
    if (payoutAccount.sellerId && payoutAccount.sellerId._id) {
      const sellerDoc = await Seller.findById(payoutAccount.sellerId._id);
      if (sellerDoc) {
        sellerDoc.accountBlocked = true;
        await sellerDoc.save();
      }
    }
  } else {
    payoutAccount.status = payoutAccount.verifiedAt ? 'verified' : 'pending';
    payoutAccount.blockedAt = null;
    payoutAccount.blockedBy = null;
    payoutAccount.blockedReason = null;
    if (payoutAccount.sellerId && payoutAccount.sellerId._id) {
      const sellerDoc = await Seller.findById(payoutAccount.sellerId._id);
      if (sellerDoc) {
        sellerDoc.accountBlocked = false;
        await sellerDoc.save();
      }
    }
  }
  await payoutAccount.save();

  const sellerUser = await User.findById(payoutAccount.sellerId.userId);
  if (sellerUser) {
    await createNotification(
      sellerUser._id,
      "payout",
      isBlocked ? "Payout Account Blocked" : "Payout Account Unblocked",
      isBlocked
        ? `Your payout account has been blocked. Reason: ${payoutAccount.blockedReason}`
        : "Your payout account has been unblocked. You can now receive payouts.",
      { accountId: payoutAccount._id },
      "/seller/payout-account"
    );
  }

  await auditLog(
    adminId,
    isBlocked ? "PAYOUT_ACCOUNT_BLOCKED" : "PAYOUT_ACCOUNT_UNBLOCKED",
    `${isBlocked ? "Blocked" : "Unblocked"} payout account ${accountId}`,
    {
      accountId: payoutAccount._id,
      sellerId: payoutAccount.sellerId._id,
      blockReason: payoutAccount.blockedReason,
    }
  );

  return res.status(200).json(
    new ApiResponse(200, payoutAccount, `Payout account ${isBlocked ? "blocked" : "unblocked"} successfully`)
  );
});

const getSellerPayoutAccount = asyncHandler(async (req, res) => {
  const { sellerId } = req.params;

  if (!mongoose.Types.ObjectId.isValid(sellerId)) {
    throw new ApiError(400, "Invalid seller ID");
  }

  const seller = await Seller.findById(sellerId);
  if (!seller) {
    throw new ApiError(404, "Seller not found");
  }

  const payoutAccount = await SellerPayoutAccount.findOne({ sellerId: seller._id })
    .populate("verifiedBy", "name email")
    .populate("blockedBy", "name email");

  if (!payoutAccount) {
    return res.status(200).json(
      new ApiResponse(200, {
        hasAccount: false,
        sellerId: seller._id,
      }, "No payout account linked for this seller")
    );
  }

  return res.status(200).json(
    new ApiResponse(200, {
      hasAccount: true,
      payoutAccount,
    }, "Payout account retrieved successfully")
  );
});

const getSellersPayoutStatus = asyncHandler(async (req, res) => {
  const { hasAccount, isVerified, page = 1, limit = 10 } = req.query;

  const match = {};
  if (hasAccount === "true") {
    match.hasAccount = true;
  } else if (hasAccount === "false") {
    match.hasAccount = false;
  }

  const sellers = await Seller.find({ status: "active" })
    .populate("userId", "name email")
    .skip((page - 1) * limit)
    .limit(parseInt(limit));

  const result = await Promise.all(
    sellers.map(async (seller) => {
      const payoutAccount = await SellerPayoutAccount.findOne({ sellerId: seller._id });
      return {
        seller: {
          _id: seller._id,
          shopName: seller.shopName,
          userId: seller.userId,
        },
        hasAccount: !!payoutAccount,
        payoutAccount: payoutAccount
          ? {
              _id: payoutAccount._id,
              accountType: payoutAccount.accountType,
              provider: payoutAccount.provider,
              status: payoutAccount.status,
              linkedAt: payoutAccount.linkedAt,
              verifiedAt: payoutAccount.verifiedAt,
            }
          : null,
      };
    })
  );

  let filtered = result;
  if (hasAccount === "true") {
    filtered = result.filter((r) => r.hasAccount);
  } else if (hasAccount === "false") {
    filtered = result.filter((r) => !r.hasAccount);
  }

  if (isVerified === "true") {
    filtered = filtered.filter((r) => r.payoutAccount?.status === 'verified');
  } else if (isVerified === "false") {
    filtered = filtered.filter((r) => r.payoutAccount && r.payoutAccount.status !== 'verified');
  }

  const total = filtered.length;
  const paginated = filtered.slice((page - 1) * limit, page * limit);

  return res.status(200).json(
    new ApiResponse(200, {
      sellers: paginated,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit),
      },
    }, "Sellers payout status retrieved successfully")
  );
});

const maskAccountIdentifier = (identifier, accountType) => {
  if (!identifier) return "";
  
  if (accountType === "paypal") {
    const [local, domain] = identifier.split("@");
    if (local.length <= 2) return identifier;
    return `${local.substring(0, 2)}***@${domain}`;
  } else if (accountType === "bank") {
    if (identifier.length <= 4) return "****";
    return `****${identifier.slice(-4)}`;
  }
  return "****";
};

export {
  linkPayoutAccount,
  getMyPayoutAccount,
  getPayPalConnectUrl,
  paypalOAuthCallback,
  verifyPayoutAccount,
  blockPayoutAccount,
  getSellerPayoutAccount,
  getSellersPayoutStatus,
};

