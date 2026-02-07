// Purpose: Custom error class for standardized API error handling
class ApiError extends Error {
    constructor(
        statusCode = "",
        message = "Something went wrong",
        errors = [],
        stack = "",
        details = null
    ) {
        super(message)
        this.statusCode = statusCode,
        this.message = message,
        this.errors = errors,
        this.data = null,
        this.success = false,
        this.details = details

        if (stack) {
            this.stack = stack
        } else {
            Error.captureStackTrace(this, this.constructor)
        }
    }
}

export { ApiError }