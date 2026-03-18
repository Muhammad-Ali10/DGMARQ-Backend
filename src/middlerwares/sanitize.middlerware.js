/**
 * NoSQL injection protection middleware.
 * Strips MongoDB operators ($gt, $ne, $or, etc.) from req.body, req.query, req.params.
 * This prevents attacks like { email: { $gt: "" }, password: { $gt: "" } }
 *
 * Compatible with Express 5 where req.query/req.params are read-only getters.
 */

const MONGO_OPERATORS = /^\$/;

const sanitizeObject = (obj) => {
  if (!obj || typeof obj !== 'object') return;

  for (const key of Object.keys(obj)) {
    if (MONGO_OPERATORS.test(key)) {
      delete obj[key];
      continue;
    }

    const val = obj[key];
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      sanitizeObject(val);
    } else if (Array.isArray(val)) {
      for (const item of val) {
        if (item && typeof item === 'object') {
          sanitizeObject(item);
        }
      }
    }
  }
};

export const sanitizeInput = (req, _res, next) => {
  // req.body is writable — mutate in-place
  if (req.body && typeof req.body === 'object') {
    sanitizeObject(req.body);
  }
  // req.query and req.params are read-only getters in Express 5
  // — mutate their properties in-place instead of reassigning
  if (req.query && typeof req.query === 'object') {
    sanitizeObject(req.query);
  }
  if (req.params && typeof req.params === 'object') {
    sanitizeObject(req.params);
  }
  next();
};
