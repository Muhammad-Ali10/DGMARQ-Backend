import { PlatformSettings } from '../models/platform.model.js';
import { ApiError } from '../utils/ApiError.js';
import { logger } from '../utils/logger.js';

const SETTINGS_KEY = 'buyer_handling_fee';
const DEFAULT_CONFIG = {
  enabled: false,
  feeType: 'percentage',
  percentageValue: 5,
  fixedAmount: 0,
};

const roundMoney = (value) => Math.round(value * 100) / 100;

export const getHandlingFeeConfig = async () => {
  try {
    const setting = await PlatformSettings.findOne({ key: SETTINGS_KEY });
    if (!setting || !setting.value || typeof setting.value !== 'object') {
      return { ...DEFAULT_CONFIG };
    }
    const v = setting.value;
    return {
      enabled: Boolean(v.enabled),
      feeType: v.feeType === 'fixed' ? 'fixed' : 'percentage',
      percentageValue: typeof v.percentageValue === 'number' ? Math.max(0, Math.min(100, v.percentageValue)) : DEFAULT_CONFIG.percentageValue,
      fixedAmount: typeof v.fixedAmount === 'number' ? Math.max(0, roundMoney(v.fixedAmount)) : DEFAULT_CONFIG.fixedAmount,
    };
  } catch (error) {
    logger.error('Failed to get handling fee config', error);
    return { ...DEFAULT_CONFIG };
  }
};

export const validateHandlingFeeConfig = (body) => {
  const enabled = Boolean(body.enabled);
  if (!enabled) {
    return { enabled: false, feeType: 'percentage', percentageValue: 5, fixedAmount: 0 };
  }
  const feeType = body.feeType === 'fixed' ? 'fixed' : 'percentage';
  if (feeType === 'percentage') {
    const percentageValue = Number(body.percentageValue);
    if (Number.isNaN(percentageValue) || percentageValue < 0 || percentageValue > 100) {
      throw new ApiError(400, 'Percentage must be between 0 and 100');
    }
    return { enabled: true, feeType: 'percentage', percentageValue, fixedAmount: 0 };
  }
  const fixedAmount = roundMoney(Number(body.fixedAmount));
  if (Number.isNaN(fixedAmount) || fixedAmount < 0) {
    throw new ApiError(400, 'Fixed amount must be a non-negative number');
  }
  return { enabled: true, feeType: 'fixed', percentageValue: 0, fixedAmount };
};

export const calculateBuyerHandlingFee = async (amountAfterDiscounts) => {
  const amount = roundMoney(Number(amountAfterDiscounts));
  if (amount < 0) {
    logger.warn('calculateBuyerHandlingFee called with negative amount, using 0');
    return { buyerHandlingFee: 0, grandTotal: 0, config: await getHandlingFeeConfig() };
  }
  const config = await getHandlingFeeConfig();
  if (!config.enabled) {
    return { buyerHandlingFee: 0, grandTotal: amount, config };
  }
  let fee = 0;
  if (config.feeType === 'percentage') {
    fee = roundMoney((amount * config.percentageValue) / 100);
  } else {
    fee = config.fixedAmount;
  }
  const grandTotal = roundMoney(amount + fee);
  return { buyerHandlingFee: fee, grandTotal, config };
};

export const assertValidHandlingFeeConfig = async () => {
  const config = await getHandlingFeeConfig();
  if (!config.enabled) return;
  if (config.feeType === 'percentage' && (config.percentageValue < 0 || config.percentageValue > 100)) {
    throw new ApiError(503, 'Buyer handling fee settings are invalid. Please contact support.');
  }
  if (config.feeType === 'fixed' && config.fixedAmount < 0) {
    throw new ApiError(503, 'Buyer handling fee settings are invalid. Please contact support.');
  }
};
