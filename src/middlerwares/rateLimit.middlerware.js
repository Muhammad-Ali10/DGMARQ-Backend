import rateLimit from 'express-rate-limit';

const RATE_LIMIT_WINDOW_MS = parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10) || 15 * 60 * 1000;
const RATE_LIMIT_MAX = parseInt(process.env.RATE_LIMIT_MAX, 10) || 300;

/** Limits general API requests per window per IP. */
export const apiLimiter = rateLimit({
  windowMs: RATE_LIMIT_WINDOW_MS,
  max: RATE_LIMIT_MAX,
  message: {
    success: false,
    message: 'Too many requests. Please wait a moment and try again.',
  },
  standardHeaders: true,
  legacyHeaders: false,
});

export const apiRateLimiter = apiLimiter;

/** Limits auth attempts to 5 per 15 min per IP. Skips successful requests. */
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  skipSuccessfulRequests: true,
  message: 'Too many login attempts, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});

/** Limits OAuth attempts to 10 per hour per IP. */
export const oauthLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  message: 'Too many OAuth attempts, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});

/** Limits checkout attempts to 20 per hour per IP. */
export const checkoutLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  message: 'Too many checkout attempts, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});

/** Limits chat messages to 30 per minute per IP. */
export const messageLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 30,
  message: 'Too many messages, please slow down.',
  standardHeaders: true,
  legacyHeaders: false,
});

/** Limits OTP email requests to 3 per 15 min per IP. */
export const otpEmailLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 3,
  message: 'Too many verification requests. Please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: false,
});

