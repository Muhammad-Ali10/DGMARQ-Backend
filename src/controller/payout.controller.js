import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { getSellerPayouts, getSellerBalance } from "../services/payout.service.js";
import { Payout } from "../models/payout.model.js";
import { Seller } from "../models/seller.model.js";
import { SellerPayoutAccount } from "../models/sellerPayoutAccount.model.js";
import mongoose from "mongoose";

// Retrieves seller's payout history with pagination
const getMyPayouts = asyncHandler(async (req, res) => {
  const sellerId = req.user.seller?._id || req.user._id;
  const { page = 1, limit = 20 } = req.query;

  const { Seller } = await import("../models/seller.model.js");
  const seller = await Seller.findOne({ userId: req.user._id });
  
  if (!seller) {
    throw new ApiError(404, "Seller account not found");
  }

  const result = await getSellerPayouts(seller._id, parseInt(page), parseInt(limit));

  return res.status(200).json(
    new ApiResponse(200, result, "Payouts retrieved successfully")
  );
});

// Retrieves detailed information for a single payout
const getPayoutDetails = asyncHandler(async (req, res) => {
  const { payoutId } = req.params;
  const userId = req.user._id;

  if (!mongoose.Types.ObjectId.isValid(payoutId)) {
    throw new ApiError(400, "Invalid payout ID");
  }

  const { Seller } = await import("../models/seller.model.js");
  const seller = await Seller.findOne({ userId });

  if (!seller) {
    throw new ApiError(404, "Seller account not found");
  }

  const payout = await Payout.findOne({
    _id: payoutId,
    sellerId: seller._id,
  })
    .populate("orderId", "totalAmount createdAt")
    .populate("sellerId", "shopName");

  if (!payout) {
    throw new ApiError(404, "Payout not found");
  }

  return res.status(200).json(
    new ApiResponse(200, payout, "Payout details retrieved successfully")
  );
});

// Retrieves seller's current payout balance
const getPayoutBalance = asyncHandler(async (req, res) => {
  const userId = req.user._id;

  const { Seller } = await import("../models/seller.model.js");
  const seller = await Seller.findOne({ userId });

  if (!seller) {
    throw new ApiError(404, "Seller account not found");
  }

  const balance = await getSellerBalance(seller._id);

  return res.status(200).json(
    new ApiResponse(200, balance, "Payout balance retrieved successfully")
  );
});

// Creates a manual payout request for the seller
const requestPayout = asyncHandler(async (req, res) => {
  const userId = req.user._id;
  const { requestedAmount, reason } = req.body;

  if (!requestedAmount || requestedAmount <= 0) {
    throw new ApiError(400, "Valid requested amount is required");
  }

  const seller = await Seller.findOne({ userId });

  if (!seller) {
    throw new ApiError(404, "Seller account not found");
  }

  if (requestedAmount < seller.minPayoutAmount) {
    throw new ApiError(400, `Minimum payout amount is $${seller.minPayoutAmount}`);
  }

  const balance = await getSellerBalance(seller._id);

  if (requestedAmount > balance.available) {
    const availableAmount = balance.available.toFixed(2);
    const daysUntilAvailable = balance.pending?.daysUntilAvailable || 0;
    let errorMessage = `Insufficient available balance. Available: $${availableAmount}`;
    
    if (daysUntilAvailable > 0) {
      errorMessage += `. Your pending balance will be available in ${daysUntilAvailable} day${daysUntilAvailable > 1 ? 's' : ''}.`;
    } else if (balance.pending?.amount > 0) {
      errorMessage += `. You have $${balance.pending.amount.toFixed(2)} on hold.`;
    }
    
    throw new ApiError(400, errorMessage);
  }

  const payoutAccount = await SellerPayoutAccount.findOne({
    sellerId: seller._id,
    status: "verified",
  });

  if (!payoutAccount) {
    throw new ApiError(400, "No verified payout account found. Please link a payout account first.");
  }

  const payoutRequest = await Payout.create({
    sellerId: seller._id,
    requestType: 'manual',
    grossAmount: requestedAmount,
    commissionAmount: 0,
    netAmount: requestedAmount,
    status: "requested",
    requestReason: reason,
    requestedAt: new Date(),
  });

  return res.status(201).json(
    new ApiResponse(201, payoutRequest, "Payout request created successfully")
  );
});

// Retrieves payout requests for the seller with optional status filtering
const getPayoutRequests = asyncHandler(async (req, res) => {
  const userId = req.user._id;
  const { page = 1, limit = 20, status } = req.query;

  const seller = await Seller.findOne({ userId });

  if (!seller) {
    throw new ApiError(404, "Seller account not found");
  }

  const match = { 
    sellerId: seller._id,
    requestType: 'manual' // Only manual payout requests
  };
  if (status) {
    match.status = status;
  }

  const skip = (parseInt(page) - 1) * parseInt(limit);

  const requests = await Payout.find(match)
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(parseInt(limit));

  const total = await Payout.countDocuments(match);

  return res.status(200).json(
    new ApiResponse(200, {
      requests,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit)),
      },
    }, "Payout requests retrieved successfully")
  );
});

// Updates the minimum payout threshold for the seller
const updateMinimumPayoutThreshold = asyncHandler(async (req, res) => {
  const userId = req.user._id;
  const { minPayoutAmount } = req.body;

  if (!minPayoutAmount || minPayoutAmount < 1) {
    throw new ApiError(400, "Minimum payout amount must be at least $1");
  }

  const seller = await Seller.findOne({ userId });

  if (!seller) {
    throw new ApiError(404, "Seller account not found");
  }

  seller.minPayoutAmount = minPayoutAmount;
  await seller.save();

  return res.status(200).json(
    new ApiResponse(200, seller, "Minimum payout threshold updated successfully")
  );
});

// Generates payout reports with optional date filtering and CSV export
const getPayoutReports = asyncHandler(async (req, res) => {
  const userId = req.user._id;
  const { startDate, endDate, format = "json" } = req.query;

  const seller = await Seller.findOne({ userId });

  if (!seller) {
    throw new ApiError(404, "Seller account not found");
  }

  const match = { sellerId: seller._id };
  if (startDate || endDate) {
    match.createdAt = {};
    if (startDate) match.createdAt.$gte = new Date(startDate);
    if (endDate) match.createdAt.$lte = new Date(endDate);
  }

  const payouts = await Payout.find(match)
    .populate("orderId", "totalAmount createdAt")
    .sort({ createdAt: -1 });

  const report = {
    period: {
      startDate: startDate || null,
      endDate: endDate || null,
    },
    summary: {
      totalPayouts: payouts.length,
      totalAmount: payouts.reduce((sum, p) => sum + p.netAmount, 0),
      totalCommission: payouts.reduce((sum, p) => sum + p.commissionAmount, 0),
      byStatus: payouts.reduce((acc, p) => {
        acc[p.status] = (acc[p.status] || 0) + 1;
        return acc;
      }, {}),
    },
    payouts: payouts.map((p) => ({
      id: p._id,
      orderId: p.orderId?._id,
      amount: p.netAmount,
      commission: p.commissionAmount,
      status: p.status,
      createdAt: p.createdAt,
    })),
  };

  if (format === "csv") {
    const csv = [
      ["Payout ID", "Order ID", "Amount", "Commission", "Status", "Date"].join(","),
      ...payouts.map((p) =>
        [
          p._id,
          p.orderId?._id || "",
          p.netAmount,
          p.commissionAmount,
          p.status,
          p.createdAt.toISOString(),
        ].join(",")
      ),
    ].join("\n");

    return res
      .status(200)
      .setHeader("Content-Type", "text/csv")
      .setHeader("Content-Disposition", `attachment; filename="payout-report-${Date.now()}.csv"`)
      .send(csv);
  }

  return res.status(200).json(
    new ApiResponse(200, report, "Payout report retrieved successfully")
  );
});

export {
  getMyPayouts,
  getPayoutDetails,
  getPayoutBalance,
  requestPayout,
  getPayoutRequests,
  updateMinimumPayoutThreshold,
  getPayoutReports,
};

