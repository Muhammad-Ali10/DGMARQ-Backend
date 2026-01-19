import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { getWalletBalance, getWalletTransactions } from "../services/wallet.service.js";

// Get customer wallet balance
const getWalletBalanceController = asyncHandler(async (req, res) => {
  const userId = req.user._id;

  const balance = await getWalletBalance(userId);

  return res.status(200).json(
    new ApiResponse(200, { balance }, "Wallet balance retrieved successfully")
  );
});

// Get wallet transactions with pagination
const getWalletTransactionsController = asyncHandler(async (req, res) => {
  const userId = req.user._id;
  const { page = 1, limit = 20 } = req.query;

  const result = await getWalletTransactions(userId, parseInt(page), parseInt(limit));

  return res.status(200).json(
    new ApiResponse(200, result, "Wallet transactions retrieved successfully")
  );
});

export {
  getWalletBalanceController,
  getWalletTransactionsController,
};
