const isDevelopment = process.env.NODE_ENV === 'development';

// Purpose: Centralized logging utility with environment-aware output levels
class Logger {
  // Purpose: Logs informational messages in development mode
  info(message, ...args) {
    if (isDevelopment) {
      console.log(`ℹ️ [INFO] ${message}`, ...args);
    }
  }

  // Purpose: Logs success messages in development mode
  success(message, ...args) {
    if (isDevelopment) {
      console.log(`✅ [SUCCESS] ${message}`, ...args);
    }
  }

  // Purpose: Logs warning messages in development mode
  warn(message, ...args) {
    if (isDevelopment) {
      console.warn(`⚠️ [WARN] ${message}`, ...args);
    }
  }

  // Purpose: Logs error messages in all environments
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

  // Purpose: Logs debug messages in development mode
  debug(message, ...args) {
    if (isDevelopment) {
      console.log(`🔍 [DEBUG] ${message}`, ...args);
    }
  }

  // Purpose: Logs HTTP request/response information
  http(method, url, statusCode = null, ...args) {
    if (isDevelopment) {
      const status = statusCode ? `[${statusCode}]` : '';
      console.log(`🌐 [HTTP] ${method} ${url} ${status}`, ...args);
    }
  }
}

export const logger = new Logger();
export default logger;
