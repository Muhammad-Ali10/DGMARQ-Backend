/**
 * HTTPS Middleware
 * 
 * Enforces HTTPS connections for PayPal CardFields compatibility.
 * PayPal CardFields requires a secure connection (HTTPS) to enable
 * automatic payment method filling.
 * 
 * In production: Redirects HTTP to HTTPS
 * In development: Allows HTTP but logs warnings for PayPal endpoints
 */

import { logger } from '../utils/logger.js';

/**
 * Middleware to enforce HTTPS for PayPal endpoints
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 */
export const enforceHTTPS = (req, res, next) => {
  const isProduction = process.env.NODE_ENV === 'production';
  const isHTTPS = req.secure || req.headers['x-forwarded-proto'] === 'https';
  const isPayPalEndpoint = req.path.includes('/paypal') || req.path.includes('/checkout');

  // In production, redirect HTTP to HTTPS
  if (isProduction && !isHTTPS) {
    const httpsUrl = `https://${req.headers.host}${req.url}`;
    return res.redirect(301, httpsUrl);
  }

  // In development, log warning for PayPal endpoints accessed via HTTP
  if (!isProduction && !isHTTPS && isPayPalEndpoint) {
    logger.warn(
      `⚠️  PayPal endpoint accessed via HTTP: ${req.method} ${req.path}`,
      {
        message: 'PayPal CardFields requires HTTPS. Consider using HTTPS in development.',
        hint: 'Frontend should be served over HTTPS (e.g., https://localhost:5173)',
      }
    );
  }

  next();
};

/**
 * Middleware to add security headers
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 */
export const securityHeaders = (req, res, next) => {
  // Add security headers for PayPal CardFields
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  
  // Allow iframe embedding for PayPal CardFields (required)
  res.setHeader('Content-Security-Policy', 
    "frame-ancestors 'self' https://*.paypal.com https://*.paypalobjects.com;"
  );

  next();
};
