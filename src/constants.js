export  const SELLER_STATUS = ['pending', 'active', 'banned'];
export  const ROLE = ['customer', 'seller', 'admin'];
export  const PAYMENT_STATUS = ['pending', 'paid', 'failed', 'refunded'];
export const ORDER_STATUS = ['pending', 'processing', 'completed', 'cancelled', 'returned', 'partially_completed', 'REFUNDED', 'PARTIALLY_REFUNDED'];
export const PAYOUT_STATUS = ['pending', 'released', 'hold', 'failed', 'blocked'];
export const REFUND_STATUS = [
  'PENDING',
  'SELLER_REVIEW',
  'SELLER_APPROVED',
  'SELLER_REJECTED',
  'ADMIN_REVIEW',
  'ADMIN_APPROVED',
  'ADMIN_REJECTED',
  'COMPLETED',
  'ON_HOLD_INSUFFICIENT_FUNDS',
  'WAITING_FOR_MANUAL_REFUND',
];

export const REFUND_METHOD = ['WALLET', 'ORIGINAL_PAYMENT', 'MANUAL'];
export const REFUND_CURRENT_STAGE = ['SELLER_REVIEW', 'ADMIN_REVIEW'];

export const REFUND_WINDOW_DAYS = 10;

export const SELLER_REVIEW_HOURS = 48;

export const PAYOUT_HOLD_DAYS = 15;
export  const SUB_STATUS = ['active', 'cancelled', 'expired'];
export  const COUPON_TYPE = ['percentage', 'fixed'];
export  const DISCOUNT_TYPE = ['percentage', 'fixed'];
export  const SUPPORT_STATUS = ['open', 'pending', 'closed'];
export  const BESTSELLER_PERIOD = ['daily', 'weekly', 'monthly', 'overall']; 