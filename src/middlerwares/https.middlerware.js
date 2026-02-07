import { logger } from '../utils/logger.js';

// Purpose: Enforces HTTPS connections and redirects HTTP to HTTPS in production
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

// Purpose: Adds security headers for XSS protection and PayPal CardFields compatibility
export const securityHeaders = (req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  
  res.setHeader('Content-Security-Policy', 
    "frame-ancestors 'self' https://*.paypal.com https://*.paypalobjects.com;"
  );

  next();
};
