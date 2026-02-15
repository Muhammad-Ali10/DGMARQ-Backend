import { logger } from '../utils/logger.js';

/** Handles all errors, returns standardized JSON. Logs 5xx; includes stack in development. */
const errorHandler = async (err, req, res, next) => {
    const statusCode = err.statusCode || 500;

    const errorResponse = {
        success: false,
        message: err.message || 'Something went wrong',
        statusCode: statusCode,
        data: null,
        errors: err.errors || [],
    };

    if (err.details) {
        errorResponse.details = err.details;
    }
    if (err.code) {
        errorResponse.code = err.code;
    }
    if (err.debug_id) {
        errorResponse.debug_id = err.debug_id;
    }

    if (process.env.NODE_ENV === "development") {
        errorResponse.stack = err.stack;
    }

    if (statusCode >= 500) {
        logger.error('Error Handler', {
            statusCode,
            message: err.message,
            url: req.originalUrl,
            method: req.method,
            details: err.details,
        }, err);
    } else if (statusCode >= 400) {
        if (process.env.NODE_ENV === "development") {
            logger.warn('Client Error', {
                statusCode,
                message: err.message,
                url: req.originalUrl,
                method: req.method,
            });
        }
    }

    res.status(statusCode).json(errorResponse);
}

export { errorHandler }