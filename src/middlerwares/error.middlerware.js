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

    // Log error for debugging
    logger.error('Error Handler', {
        statusCode,
        message: err.message,
        url: req.originalUrl,
        method: req.method,
        details: err.details,
    }, err);

    res.status(statusCode).json(errorResponse);
}

export { errorHandler }