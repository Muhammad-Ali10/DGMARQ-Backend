/**
 * Centralized logging utility for the backend
 * Replaces all console.log/console.error with proper logging
 */

const isDevelopment = process.env.NODE_ENV === 'development';

class Logger {
  /**
   * Log info messages (development only)
   */
  info(message, ...args) {
    if (isDevelopment) {
      console.log(`ℹ️ [INFO] ${message}`, ...args);
    }
  }

  /**
   * Log success messages
   */
  success(message, ...args) {
    if (isDevelopment) {
      console.log(`✅ [SUCCESS] ${message}`, ...args);
    }
  }

  /**
   * Log warning messages
   */
  warn(message, ...args) {
    if (isDevelopment) {
      console.warn(`⚠️ [WARN] ${message}`, ...args);
    }
  }

  /**
   * Log error messages (always logged, even in production)
   */
  error(message, error = null, ...args) {
    const errorDetails = error instanceof Error 
      ? {
          message: error.message,
          stack: error.stack,
          ...(error.statusCode && { statusCode: error.statusCode }),
        }
      : error;

    console.error(`❌ [ERROR] ${message}`, errorDetails || '', ...args);
  }

  /**
   * Log debug messages (development only)
   */
  debug(message, ...args) {
    if (isDevelopment) {
      console.log(`🔍 [DEBUG] ${message}`, ...args);
    }
  }

  /**
   * Log HTTP request/response
   */
  http(method, url, statusCode = null, ...args) {
    if (isDevelopment) {
      const status = statusCode ? `[${statusCode}]` : '';
      console.log(`🌐 [HTTP] ${method} ${url} ${status}`, ...args);
    }
  }
}

// Export singleton instance
export const logger = new Logger();
export default logger;
