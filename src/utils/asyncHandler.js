// Purpose: Wraps async route handlers to catch and forward errors
export const asyncHandler = (requestHandler) => (req, res, next) => {
    Promise.resolve(requestHandler(req, res, next)).catch(next);
};
 