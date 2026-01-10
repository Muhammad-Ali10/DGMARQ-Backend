import rateLimit from 'express-rate-limit';

// Note: For Redis-backed rate limiting, install 'rate-limit-redis' package
// For now, using memory store (works for single server)
// In production with multiple servers, use Redis store

// General API rate limiter
export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});

// Alias for apiLimiter (for backward compatibility)
export const apiRateLimiter = apiLimiter;

// Authentication rate limiter (stricter)
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 login attempts per 15 minutes
  skipSuccessfulRequests: true,
  message: 'Too many login attempts, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});

// OAuth rate limiter
export const oauthLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10, // 10 OAuth attempts per hour
  message: 'Too many OAuth attempts, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});

// Checkout rate limiter
export const checkoutLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 20, // 20 checkout attempts per hour
  message: 'Too many checkout attempts, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});

// Message sending rate limiter (for chat)
export const messageLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 30, // 30 messages per minute
  message: 'Too many messages, please slow down.',
  standardHeaders: true,
  legacyHeaders: false,
});

// OTP email rate limiter (stricter to prevent spam)
export const otpEmailLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 3, // 3 OTP requests per 15 minutes
  message: 'Too many verification requests. Please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: false,
});

