import { logger } from '../utils/logger.js';

const errorHandler = async (err, req, res, next) => {
    const statusCode = err.statusCode || 500;

    // Enhanced error response with details
    const errorResponse = {
        success: false,
        message: err.message || 'Something went wrong',
        statusCode: statusCode,
        data: null,
        errors: err.errors || [],
    };

    // Add details if present (for validation errors)
    if (err.details) {
        errorResponse.details = err.details;
    }

    // Add stack trace in development
    if (process.env.NODE_ENV === "development") {
        errorResponse.stack = err.stack;
    }

    // Log errors appropriately:
    // - 4xx (client errors) are expected (wrong password, invalid token, etc.) - log as warn/info
    // - 5xx (server errors) are unexpected - log as error
    if (statusCode >= 500) {
        // Server errors - unexpected, log as error
        logger.error('Error Handler', {
            statusCode,
            message: err.message,
            url: req.originalUrl,
            method: req.method,
            details: err.details,
        }, err);
    } else if (statusCode >= 400) {
        // Client errors - expected (authentication failures, validation errors, etc.)
        // Only log in development, or at debug level in production
        if (process.env.NODE_ENV === "development") {
            logger.warn('Client Error', {
                statusCode,
                message: err.message,
                url: req.originalUrl,
                method: req.method,
            });
        }
        // In production, skip logging expected client errors to reduce log noise
        // They're normal (wrong passwords, invalid tokens, etc.)
    }

    res.status(statusCode).json(errorResponse);
}

export { errorHandler }