import mongoose from "mongoose";
import { Wallet } from "../models/wallet.model.js";
import { ApiError } from "../utils/ApiError.js";
import { logger } from "../utils/logger.js";

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

export const getWalletBalance = async (userId) => {
  const wallet = await getOrCreateWallet(userId);
  
  const balance = wallet.balance || 0;
  const balanceNumber = typeof balance === 'number' ? balance : parseFloat(balance || 0);
  
  logger.debug("Wallet balance retrieved", {
    userId: userId.toString(),
    balance: balanceNumber,
    walletId: wallet._id.toString()
  });
  
  return balanceNumber;
};

export const creditWallet = async (userId, amount, description, metadata = {}, existingSession = null) => {
  if (amount <= 0) {
    throw new ApiError(400, "Credit amount must be greater than 0");
  }

  const useExistingSession = existingSession !== null;
  const session = existingSession || await mongoose.startSession();
  
  if (!useExistingSession) {
    session.startTransaction();
  }

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
          createdAt: new Date(),
          ...metadata,
        }],
      }], { session });
      
      if (!useExistingSession) {
        await session.commitTransaction();
      }
      return newWallet[0];
    }

    const oldBalance = wallet.balance || 0;
    wallet.balance = oldBalance + amount;
    wallet.transactions.push({
      type: 'credit',
      amount,
      description,
      createdAt: new Date(),
      ...metadata,
    });

    await wallet.save({ session });
    
    await wallet.populate('userId');
    
    if (!useExistingSession) {
      await session.commitTransaction();
    }

    logger.info("Wallet credited successfully", {
      userId: userId.toString(),
      walletId: wallet._id.toString(),
      oldBalance: oldBalance.toFixed(2),
      creditAmount: amount.toFixed(2),
      newBalance: wallet.balance.toFixed(2),
      description,
      useExistingSession,
      transactionId: session.id?.toString() || 'N/A'
    });

    return wallet;
  } catch (error) {
    if (!useExistingSession) {
      await session.abortTransaction();
    }
    logger.error("Wallet credit failed", {
      userId: userId.toString(),
      amount: amount.toFixed(2),
      error: error.message,
      stack: error.stack
    });
    throw error;
  } finally {
    if (!useExistingSession) {
      session.endSession();
    }
  }
};

export const debitWallet = async (userId, amount, description, metadata = {}, existingSession = null) => {
  if (amount <= 0) {
    throw new ApiError(400, "Debit amount must be greater than 0");
  }

  const useExistingSession = existingSession !== null;
  const session = existingSession || await mongoose.startSession();
  
  if (!useExistingSession) {
    session.startTransaction();
  }

  try {
    let wallet = await Wallet.findOne({ userId }).session(session);
    
    if (!wallet) {
      wallet = await Wallet.create([{
        userId,
        balance: 0,
        currency: "USD",
        transactions: [],
      }], { session });
      wallet = wallet[0];
    }

    const currentBalance = wallet.balance || 0;
    
    if (currentBalance < amount) {
      if (!useExistingSession && session.inTransaction()) {
        await session.abortTransaction();
      }
      throw new ApiError(400, `Insufficient wallet balance. Available: $${currentBalance.toFixed(2)}, Required: $${amount.toFixed(2)}`);
    }

    const transactionId = new mongoose.Types.ObjectId();
    const transactionRecord = {
      _id: transactionId,
      type: 'debit',
      amount,
      description,
      createdAt: new Date(),
      ...metadata,
    };

    const updatedWallet = await Wallet.findOneAndUpdate(
      { userId },
      {
        $inc: { balance: -amount },
        $push: { transactions: transactionRecord },
      },
      {
        session,
        new: true, // Return updated document
        runValidators: true,
      }
    );

    if (!updatedWallet) {
      throw new ApiError(500, "Failed to update wallet balance");
    }

    if (updatedWallet.balance < 0) {
      await Wallet.findOneAndUpdate(
        { userId },
        { $inc: { balance: amount } },
        { session }
      );
      if (!useExistingSession && session.inTransaction()) {
        await session.abortTransaction();
      }
      throw new ApiError(400, `Insufficient wallet balance. Available: $${currentBalance.toFixed(2)}, Required: $${amount.toFixed(2)}`);
    }
    
    if (!useExistingSession) {
      await session.commitTransaction();
    }

    logger.info("Wallet debited successfully", {
      userId: userId.toString(),
      oldBalance: currentBalance.toFixed(2),
      debitAmount: amount.toFixed(2),
      newBalance: updatedWallet.balance.toFixed(2),
      description,
      transactionId: transactionId.toString(),
      useExistingSession,
    });

    return {
      wallet: updatedWallet,
      transactionId: transactionId,
    };
  } catch (error) {
    if (!useExistingSession && session.inTransaction()) {
      await session.abortTransaction();
    }
    logger.error("Wallet debit failed", {
      userId: userId.toString(),
      amount: amount.toFixed(2),
      error: error.message,
      stack: error.stack
    });
    throw error;
  } finally {
    if (!useExistingSession && session && !session.hasEnded) {
      session.endSession();
    }
  }
};

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
