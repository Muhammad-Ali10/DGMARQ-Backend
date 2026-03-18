import { ApiError } from "../utils/ApiError.js";

/**
 * Generic Zod schema validation middleware.
 * Validates req.body, req.query, and req.params against a Zod schema.
 *
 * Usage:
 *   import { z } from 'zod';
 *   const schema = z.object({
 *     body: z.object({ email: z.string().email(), password: z.string().min(8) }),
 *   });
 *   router.post('/login', validate(schema), loginUser);
 */
export const validate = (schema) => (req, _res, next) => {
  const result = schema.safeParse({
    body: req.body,
    query: req.query,
    params: req.params,
  });

  if (!result.success) {
    const errors = result.error.errors.map((e) => ({
      field: e.path.join("."),
      message: e.message,
    }));
    throw new ApiError(400, "Validation failed", errors);
  }

  next();
};
