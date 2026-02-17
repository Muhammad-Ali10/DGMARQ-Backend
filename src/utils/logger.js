const isDevelopment = process.env.NODE_ENV === 'development';

class Logger {
  info(message, ...args) {
    if (isDevelopment) {
      console.log(`ℹ️ [INFO] ${message}`, ...args);
    }
  }

  success(message, ...args) {
    if (isDevelopment) {
      console.log(`✅ [SUCCESS] ${message}`, ...args);
    } else if (typeof message === 'string' && (message.includes('MongoDB') || message.includes('Server is running') || message.includes('running at port'))) {
      // Always log critical startup messages
      console.log(`✅ [SUCCESS] ${message}`, ...args);
    }
  }

  warn(message, ...args) {
    if (isDevelopment) {
      console.warn(`⚠️ [WARN] ${message}`, ...args);
    }
  }

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

  debug(message, ...args) {
    if (isDevelopment) {
      console.log(`🔍 [DEBUG] ${message}`, ...args);
    }
  }

  http(method, url, statusCode = null, ...args) {
    if (isDevelopment) {
      const status = statusCode ? `[${statusCode}]` : '';
      console.log(`🌐 [HTTP] ${method} ${url} ${status}`, ...args);
    }
  }
}

export const logger = new Logger();
export default logger;
