import { logger } from '../utils/logger.js';

/** Redirects HTTP to HTTPS in production. Logs warning for PayPal endpoints on HTTP in dev. */
export const enforceHTTPS = (req, res, next) => {
  const isProduction = process.env.NODE_ENV === 'production';
  const isHTTPS = req.secure || req.headers['x-forwarded-proto'] === 'https';
  const isPayPalEndpoint = req.path.includes('/paypal') || req.path.includes('/checkout');

  if (isProduction && !isHTTPS) {
    const httpsUrl = `https://${req.headers.host}${req.url}`;
    return res.redirect(301, httpsUrl);
  }

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

/** Sets security headers: X-Content-Type-Options, X-Frame-Options, CSP for PayPal. */
export const securityHeaders = (req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  
  res.setHeader('Content-Security-Policy', 
    "frame-ancestors 'self' https://*.paypal.com https://*.paypalobjects.com;"
  );

  next();
};
