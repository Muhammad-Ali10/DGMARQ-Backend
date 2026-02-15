/**
 * Environment validation and secure config loader.
 * Validates required variables at startup; does not expose secrets.
 */
import { logger } from '../utils/logger.js';

const required = [
  'ACCESS_TOKEN_SECRET',
  'REFRESH_TOKEN_SECRET',
];

function hasDbConfig() {
  if (process.env.MONGODB_URI && process.env.MONGODB_URI.trim()) return true;
  return process.env.MONGO_URI && process.env.MONGO_URI.trim() && process.env.DB_Name && process.env.DB_Name.trim();
}

const requiredProduction = [
  'FRONTEND_URL',
  'SESSION_SECRET',
];

const optionalWithDefaults = {
  NODE_ENV: 'development',
  PORT: '5000',
  PAYPAL_ENV: 'sandbox',
};

/**
 * Validates required env vars. Throws if any missing in current NODE_ENV.
 */
export function validateEnv() {
  const missing = required.filter((key) => {
    const v = process.env[key];
    return !v || (typeof v === 'string' && v.trim() === '');
  });
  if (missing.length) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}. Check .env or env.template.`);
  }
  if (!hasDbConfig()) {
    throw new Error('Missing database config: set MONGODB_URI or both MONGO_URI and DB_Name.');
  }

  const isProduction = process.env.NODE_ENV === 'production';
  if (isProduction) {
    const missingProd = requiredProduction.filter((key) => {
      const v = process.env[key];
      return !v || (typeof v === 'string' && v.trim() === '');
    });
    if (missingProd.length) {
      throw new Error(`Production missing required variables: ${missingProd.join(', ')}.`);
    }
  }

  Object.entries(optionalWithDefaults).forEach(([key, def]) => {
    if (process.env[key] === undefined || process.env[key] === '') {
      process.env[key] = def;
    }
  });

  logger.info('[Config] Environment validated', {
    NODE_ENV: process.env.NODE_ENV,
    PORT: process.env.PORT,
    hasRedis: !!process.env.REDIS_URL,
    paypalEnv: process.env.PAYPAL_ENV || 'sandbox',
  });
  return true;
}

/**
 * Returns safe config for non-sensitive values only. Never include secrets.
 */
export function getPublicConfig() {
  return {
    NODE_ENV: process.env.NODE_ENV,
    paypalEnv: process.env.PAYPAL_ENV || 'sandbox',
  };
}
