// Purpose: Define allowed seller account statuses
export  const SELLER_STATUS = ['pending', 'active', 'banned'];
// Purpose: Define user role types for access control
export  const ROLE = ['customer', 'seller', 'admin'];
// Purpose: Define payment transaction statuses
export  const PAYMENT_STATUS = ['pending', 'paid', 'failed', 'refunded'];
// Purpose: Define order lifecycle statuses (partially_completed = some keys refunded, not all)
export const ORDER_STATUS = ['pending', 'processing', 'completed', 'cancelled', 'returned', 'partially_completed'];
// Purpose: Define seller payout statuses
export  const PAYOUT_STATUS = ['pending', 'released', 'hold', 'failed', 'blocked'];
// Purpose: Define refund request statuses (strict flow)
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
// Refund method: WALLET (credit buyer wallet) or MANUAL/ORIGINAL_PAYMENT (PayPal/bank via admin)
export const REFUND_METHOD = ['WALLET', 'ORIGINAL_PAYMENT', 'MANUAL'];
// Purpose: Refund current stage for workflow
export const REFUND_CURRENT_STAGE = ['SELLER_REVIEW', 'ADMIN_REVIEW'];
// Refund allowed only within this many days of order completion
export const REFUND_WINDOW_DAYS = 10;
// Seller has this many hours to respond when refund is in seller review; admin cannot approve before seller responds or this period ends
export const SELLER_REVIEW_HOURS = 48;
// Seller payout is held for this many days after order completion (money with platform)
export const PAYOUT_HOLD_DAYS = 15;
// Purpose: Define subscription statuses
export  const SUB_STATUS = ['active', 'cancelled', 'expired'];
// Purpose: Define coupon discount calculation types
export  const COUPON_TYPE = ['percentage', 'fixed'];
// Purpose: Define general discount calculation types
export  const DISCOUNT_TYPE = ['percentage', 'fixed'];
// Purpose: Define support ticket statuses
export  const SUPPORT_STATUS = ['open', 'pending', 'closed'];
// Purpose: Define bestseller tracking time periods
export  const BESTSELLER_PERIOD = ['daily', 'weekly', 'monthly', 'overall']; 