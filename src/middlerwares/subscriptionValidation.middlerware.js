import { ApiError } from '../utils/ApiError.js';
import { validatePlanIdFormat } from '../services/payment.service.js';

/**
 * Validates subscription plan ID (env or body.plan_id).
 * Ensures P-xxx format before PayPal calls.
 */
export const validateSubscriptionPlanId = (options = {}) => {
  const { allowBodyPlanId = false } = options;
  return (req, res, next) => {
    const planId = allowBodyPlanId && req.body?.plan_id
      ? String(req.body.plan_id).trim()
      : (process.env.PAYPAL_SUBSCRIPTION_PLAN_ID || '').trim();

    if (!planId) {
      return next(new ApiError(503, 'Subscription is not configured. Set PAYPAL_SUBSCRIPTION_PLAN_ID in server environment.'));
    }

    const check = validatePlanIdFormat(planId);
    if (!check.valid) {
      return next(new ApiError(400, check.error));
    }
    next();
  };
};
