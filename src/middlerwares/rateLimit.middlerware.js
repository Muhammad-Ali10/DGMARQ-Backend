import rateLimit from 'express-rate-limit';

// Purpose: Limits general API requests to 100 per 15 minutes per IP
export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});

export const apiRateLimiter = apiLimiter;

// Purpose: Limits authentication attempts to 5 per 15 minutes per IP
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  skipSuccessfulRequests: true,
  message: 'Too many login attempts, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});

// Purpose: Limits OAuth attempts to 10 per hour per IP
export const oauthLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  message: 'Too many OAuth attempts, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});

// Purpose: Limits checkout attempts to 20 per hour per IP
export const checkoutLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  message: 'Too many checkout attempts, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});

// Purpose: Limits chat messages to 30 per minute per IP
export const messageLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 30,
  message: 'Too many messages, please slow down.',
  standardHeaders: true,
  legacyHeaders: false,
});

// Purpose: Limits OTP email requests to 3 per 15 minutes per IP
export const otpEmailLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 3,
  message: 'Too many verification requests. Please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: false,
});

