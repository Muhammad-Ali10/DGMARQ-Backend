import mongoose from "mongoose";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { SellerPayoutAccount } from "../models/sellerPayoutAccount.model.js";
import { Seller } from "../models/seller.model.js";
import { User } from "../models/user.model.js";
import { createNotification } from "../services/notification.service.js";
import { auditLog } from "../services/audit.service.js";
import { encryptKey, decryptKey } from "../utils/encryption.js";
import { validatePayPalEmail } from "../services/payment.service.js";

// Links a PayPal payout account for a seller with encryption and admin notification
const linkPayoutAccount = asyncHandler(async (req, res) => {
  const userId = req.user._id;
  const { accountType, accountIdentifier, accountName, bankName } = req.body;

  if (!accountType || !accountIdentifier) {
    throw new ApiError(400, "accountType and accountIdentifier are required");
  }

  if (accountType !== "paypal") {
    throw new ApiError(400, "Only PayPal accounts are supported. Please provide a PayPal account.");
  }

  // Validate PayPal email format and attempt API validation
  const emailValidation = await validatePayPalEmail(accountIdentifier);
  if (!emailValidation.isValid) {
    throw new ApiError(400, `Invalid PayPal email: ${emailValidation.error}`);
  }

  const seller = await Seller.findOne({ userId });
  if (!seller) {
    throw new ApiError(404, "Seller profile not found");
  }

  const encryptedAccountIdentifier = encryptKey(accountIdentifier);

  let payoutAccount = await SellerPayoutAccount.findOne({ sellerId: seller._id });

  if (payoutAccount) {
    payoutAccount.accountType = accountType;
    payoutAccount.accountIdentifier = accountIdentifier;
    payoutAccount.encryptedAccountIdentifier = encryptedAccountIdentifier;
    payoutAccount.provider = 'paypal';
    if (accountName) payoutAccount.accountName = accountName;
    if (bankName) payoutAccount.bankName = bankName;
    payoutAccount.status = 'pending';
    payoutAccount.verifiedAt = null;
    payoutAccount.verifiedBy = null;
    payoutAccount.linkedAt = new Date();
    await payoutAccount.save();
  } else {
    payoutAccount = await SellerPayoutAccount.create({
      sellerId: seller._id,
      accountType,
      accountIdentifier,
      encryptedAccountIdentifier,
      provider: 'paypal',
      accountName,
      bankName,
      status: 'pending',
      linkedAt: new Date(),
    });
  }

  seller.payoutAccount = accountIdentifier;
  await seller.save();

  const adminUsers = await User.find({ roles: "admin", isActive: true });
  for (const admin of adminUsers) {
    await createNotification(
      admin._id,
      "payout",
      "New Payout Account Linked",
      `Seller ${req.user.name} has linked a ${accountType} payout account. Verification required.`,
      { sellerId: seller._id, accountId: payoutAccount._id },
      `/admin/sellers/${seller._id}/payout-account`
    );
  }

  await auditLog(userId, "PAYOUT_ACCOUNT_LINKED", `Linked ${accountType} payout account`, {
    sellerId: seller._id,
    accountId: payoutAccount._id,
    accountType,
  });

  const maskedAccount = {
    ...payoutAccount.toObject(),
    accountIdentifier: maskAccountIdentifier(payoutAccount.accountIdentifier, payoutAccount.accountType || payoutAccount.provider),
    encryptedAccountIdentifier: undefined,
  };

  return res.status(200).json(
    new ApiResponse(200, {
      payoutAccount: maskedAccount,
      message: "Payout account linked successfully. It will be verified by an admin shortly.",
    }, "Payout account linked successfully")
  );
});

// Retrieves seller's payout account status with masked sensitive information
const getMyPayoutAccount = asyncHandler(async (req, res) => {
  const userId = req.user._id;

  const seller = await Seller.findOne({ userId });
  if (!seller) {
    throw new ApiError(404, "Seller profile not found");
  }

  const payoutAccount = await SellerPayoutAccount.findOne({ sellerId: seller._id });

  if (!payoutAccount) {
    return res.status(200).json(
      new ApiResponse(200, {
        hasAccount: false,
        message: "No payout account linked. Please link an account to receive payouts.",
      }, "No payout account found")
    );
  }

  const maskedAccount = {
    ...payoutAccount.toObject(),
    accountIdentifier: maskAccountIdentifier(payoutAccount.accountIdentifier, payoutAccount.accountType || payoutAccount.provider),
    encryptedAccountIdentifier: undefined,
  };

  return res.status(200).json(
    new ApiResponse(200, {
      hasAccount: true,
      payoutAccount: maskedAccount,
    }, "Payout account retrieved successfully")
  );
});

// Verifies a payout account and notifies the seller
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

  // Notify seller
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

// Blocks or unblocks a payout account and notifies the seller
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
  } else {
    payoutAccount.status = payoutAccount.verifiedAt ? 'verified' : 'pending';
    payoutAccount.blockedAt = null;
    payoutAccount.blockedBy = null;
    payoutAccount.blockedReason = null;
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

// Retrieves a seller's payout account details for admin
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

// Retrieves all sellers with their payout account status and optional filtering
const getSellersPayoutStatus = asyncHandler(async (req, res) => {
  const { hasAccount, isVerified, page = 1, limit = 20 } = req.query;

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

// Masks account identifier for secure display in responses
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
  verifyPayoutAccount,
  blockPayoutAccount,
  getSellerPayoutAccount,
  getSellersPayoutStatus,
};

