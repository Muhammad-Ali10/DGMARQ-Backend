import mongoose from "mongoose";
import { Wallet } from "../models/wallet.model.js";
import { ApiError } from "../utils/ApiError.js";
import { logger } from "../utils/logger.js";

/**
 * Get or create wallet for a user
 */
export const getOrCreateWallet = async (userId) => {
  let wallet = await Wallet.findOne({ userId });
  
  if (!wallet) {
    wallet = await Wallet.create({
      userId,
      balance: 0,
      currency: "USD",
      transactions: [],
    });
  }
  
  return wallet;
};

/**
 * Get wallet balance for a user
 */
export const getWalletBalance = async (userId) => {
  const wallet = await getOrCreateWallet(userId);
  return wallet.balance;
};

/**
 * Credit amount to user wallet
 */
export const creditWallet = async (userId, amount, description, metadata = {}) => {
  if (amount <= 0) {
    throw new ApiError(400, "Credit amount must be greater than 0");
  }

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const wallet = await Wallet.findOne({ userId }).session(session);
    
    if (!wallet) {
      const newWallet = await Wallet.create([{
        userId,
        balance: amount,
        currency: "USD",
        transactions: [{
          type: 'credit',
          amount,
          description,
          ...metadata,
        }],
      }], { session });
      await session.commitTransaction();
      return newWallet[0];
    }

    wallet.balance = (wallet.balance || 0) + amount;
    wallet.transactions.push({
      type: 'credit',
      amount,
      description,
      ...metadata,
    });

    await wallet.save({ session });
    await session.commitTransaction();

    return wallet;
  } catch (error) {
    await session.abortTransaction();
    logger.error("Wallet credit failed", error);
    throw error;
  } finally {
    session.endSession();
  }
};

/**
 * Debit amount from user wallet
 */
export const debitWallet = async (userId, amount, description, metadata = {}) => {
  if (amount <= 0) {
    throw new ApiError(400, "Debit amount must be greater than 0");
  }

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const wallet = await Wallet.findOne({ userId }).session(session);
    
    if (!wallet) {
      throw new ApiError(404, "Wallet not found");
    }

    const currentBalance = wallet.balance || 0;
    
    if (currentBalance < amount) {
      await session.abortTransaction();
      throw new ApiError(400, `Insufficient wallet balance. Available: $${currentBalance.toFixed(2)}, Required: $${amount.toFixed(2)}`);
    }

    wallet.balance = currentBalance - amount;
    wallet.transactions.push({
      type: 'debit',
      amount,
      description,
      ...metadata,
    });

    await wallet.save({ session });
    await session.commitTransaction();

    return wallet;
  } catch (error) {
    await session.abortTransaction();
    logger.error("Wallet debit failed", error);
    throw error;
  } finally {
    session.endSession();
  }
};

/**
 * Get wallet transactions with pagination
 */
export const getWalletTransactions = async (userId, page = 1, limit = 20) => {
  const wallet = await Wallet.findOne({ userId });
  
  if (!wallet) {
    return {
      transactions: [],
      pagination: {
        page: 1,
        limit,
        total: 0,
        pages: 0,
      },
    };
  }

  const transactions = wallet.transactions
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice((page - 1) * limit, page * limit);

  return {
    transactions,
    pagination: {
      page,
      limit,
      total: wallet.transactions.length,
      pages: Math.ceil(wallet.transactions.length / limit),
    },
  };
};
