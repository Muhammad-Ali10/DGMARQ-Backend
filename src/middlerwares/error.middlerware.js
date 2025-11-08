
const errorHandler = async (err, req, res, next) => {

    const statusCode = err.statusCode || 500

    res.status(statusCode).json({
        message: err.message,
        statusCode: statusCode,
        data: null,
        errors: err.errors,
        stack: process.env.NODE_ENV === "development" ? err.stack : undefined
    })

}

export { errorHandler }