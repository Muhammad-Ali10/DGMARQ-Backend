import { logger } from '../utils/logger.js';

// Purpose: Rounds a value to 2 decimal places
const round2 = (value) => Math.round(Number(value) * 100) / 100;

// Purpose: Normalizes commission rate to a value between 0 and 1
const normalizeCommissionRate = (rate) => {
  const r = Number(rate);
  if (Number.isNaN(r) || r < 0) return 0;
  if (r > 1 && r <= 100) return round2(r / 100);
  return Math.min(1, round2(r));
};

// Purpose: Computes order revenue breakdown including seller and admin earnings
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

// Purpose: Computes revenue breakdown for a single order item
export const computeItemRevenue = (lineTotal, commissionRate) => {
  const line = round2(Math.max(0, Number(lineTotal)));
  const rate = normalizeCommissionRate(commissionRate);
  const commissionAmount = round2(line * rate);
  const sellerEarning = round2(line - commissionAmount);
  return { lineTotal: line, commissionAmount, sellerEarning: Math.max(0, sellerEarning) };
};

// Purpose: Logs revenue verification details in non-production environments
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
