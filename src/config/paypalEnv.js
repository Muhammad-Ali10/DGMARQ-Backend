/**
 * PayPal environment validation and base URL resolution.
 * Ensures PAYPAL_ENV, PAYPAL_API_BASE (optional), and credentials are consistent.
 */
import { logger } from '../utils/logger.js';

const SANDBOX_API = 'https://api-m.sandbox.paypal.com';
const LIVE_API = 'https://api-m.paypal.com';

let _envLogged = false;

/**
 * Returns the PayPal API base URL. Prefers PAYPAL_API_BASE if set and consistent with PAYPAL_ENV.
 * Otherwise derives from PAYPAL_ENV. Logs environment on first use.
 */
export function getPayPalBaseUrl() {
  const paypalEnv = (process.env.PAYPAL_ENV || 'sandbox').toString().trim().toLowerCase();
  const explicitBase = (process.env.PAYPAL_API_BASE || '').toString().trim().replace(/\/$/, '');

  const isProduction = paypalEnv === 'production';
  const expectedBase = isProduction ? LIVE_API : SANDBOX_API;

  if (explicitBase) {
    const explicitIsSandbox = explicitBase.includes('sandbox');
    const explicitIsLive = explicitBase.includes('api-m.paypal.com') && !explicitIsSandbox;
    const matchesEnv =
      (isProduction && explicitIsLive) || (!isProduction && explicitIsSandbox);
    if (!matchesEnv) {
      logger.warn('[PayPal] PAYPAL_API_BASE does not match PAYPAL_ENV', {
        PAYPAL_ENV: paypalEnv,
        PAYPAL_API_BASE: explicitBase,
        expected: expectedBase,
      });
    }
    logEnvironmentOnce(isProduction, explicitBase);
    return explicitBase;
  }

  logEnvironmentOnce(isProduction, expectedBase);
  return expectedBase;
}

function logEnvironmentOnce(isProduction, baseUrl) {
  if (_envLogged) return;
  _envLogged = true;
  const envLabel = isProduction ? 'PRODUCTION' : 'SANDBOX';
  logger.info(`[PayPal] Environment: ${envLabel}, API base: ${baseUrl}`);
}

/**
 * Validates that PayPal env, optional base URL, and credentials are consistent.
 * Call at startup or before first subscription/payout. Throws if invalid.
 */
export function validatePayPalEnvironment() {
  const clientId = (process.env.PAYPAL_CLIENT_ID || '').toString().trim();
  const clientSecret = (process.env.PAYPAL_CLIENT_SECRET || '').toString().trim();
  const paypalEnv = (process.env.PAYPAL_ENV || 'sandbox').toString().trim().toLowerCase();

  if (!clientId || clientId === 'your_paypal_client_id') {
    throw new Error('PAYPAL_CLIENT_ID is missing or not configured.');
  }
  if (!clientSecret || clientSecret === 'your_paypal_client_secret') {
    throw new Error('PAYPAL_CLIENT_SECRET is missing or not configured.');
  }

  const baseUrl = getPayPalBaseUrl();
  const isProduction = paypalEnv === 'production';
  if (isProduction && baseUrl.includes('sandbox')) {
    throw new Error('PAYPAL_ENV=production but API base URL is sandbox. Set PAYPAL_API_BASE to https://api-m.paypal.com or fix PAYPAL_ENV.');
  }
  if (!isProduction && baseUrl === LIVE_API) {
    throw new Error('PAYPAL_ENV=sandbox but API base URL is live. Set PAYPAL_API_BASE to https://api-m.sandbox.paypal.com or fix PAYPAL_ENV.');
  }

  return { baseUrl, isProduction, clientId: clientId.substring(0, 8) + '...' };
}

export { SANDBOX_API, LIVE_API };
