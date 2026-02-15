import { logger } from '../utils/logger.js';

const round2 = (value) => Math.round(Number(value) * 100) / 100;

const normalizeCommissionRate = (rate) => {
  const r = Number(rate);
  if (Number.isNaN(r) || r < 0) return 0;
  if (r > 1 && r <= 100) return round2(r / 100);
  return Math.min(1, round2(r));
};

export const computeOrderRevenue = (productSubtotal, handlingFee, commissionRate) => {
  const subtotal = round2(Math.max(0, Number(productSubtotal)));
  const fee = round2(Math.max(0, Number(handlingFee)));
  const rate = normalizeCommissionRate(commissionRate);
  const commissionAmount = round2(subtotal * rate);
  const sellerEarning = round2(subtotal - commissionAmount);
  const adminEarning = round2(commissionAmount + fee);
  const totalPaid = round2(subtotal + fee);
  const safeSellerEarning = Math.max(0, sellerEarning);
  return {
    productSubtotal: subtotal,
    handlingFee: fee,
    commissionRate: rate,
    commissionAmount,
    sellerEarning: safeSellerEarning,
    adminEarning,
    totalPaid,
  };
};

export const computeItemRevenue = (lineTotal, commissionRate, extraCommissionRate = 0) => {
  const line = round2(Math.max(0, Number(lineTotal)));
  const baseRate = normalizeCommissionRate(commissionRate);
  const extraRate = normalizeCommissionRate(extraCommissionRate);
  const normalCommissionAmount = round2(line * baseRate);
  const featuredExtraCommissionAmount = round2(line * extraRate);
  const commissionAmount = round2(normalCommissionAmount + featuredExtraCommissionAmount);
  const sellerEarning = round2(line - commissionAmount);
  return {
    lineTotal: line,
    commissionAmount,
    sellerEarning: Math.max(0, sellerEarning),
    normalCommissionAmount,
    featuredExtraCommissionAmount,
  };
};

export const logRevenueVerification = (productSubtotal, handlingFee, commissionAmount, sellerEarning, adminEarning, totalPaid) => {
  if (process.env.NODE_ENV !== 'production') {
    logger.info('[REVENUE VERIFY]', {
      productSubtotal,
      handlingFee,
      commissionAmount,
      sellerEarning,
      adminEarning,
      totalPaid,
    });
  }
};
