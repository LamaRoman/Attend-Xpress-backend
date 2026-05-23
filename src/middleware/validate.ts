import { Request, Response, NextFunction } from 'express';
import { ZodSchema, ZodError } from 'zod';

/**
 * Generic validation middleware factory.
 * Validates req.body, req.query, or req.params against a Zod schema.
 *
 * All schemas in this codebase are flat — no body/query/params wrapper.
 * e.g. z.object({ email: z.string(), password: z.string() })
 *
 * Usage:
 *   router.post('/login', validate(loginSchema), controller.login)
 *   router.get('/records', validate(querySchema, 'query'), controller.list)
 */
export function validate(
  schema: ZodSchema,
  source: 'body' | 'query' | 'params' = 'body'
) {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req[source]);

    if (!result.success) {
      const errors = formatZodErrors(result.error);
      return res.status(400).json({
        error: {
          message: 'Validation failed',
          code: 'VALIDATION_ERROR',
          details: errors,
        },
      });
    }

    // Replace source with parsed (coerced, transformed, defaulted) data
    req[source] = result.data;
    next();
  };
}

/**
 * Format Zod errors into a clean array.
 */
function formatZodErrors(error: ZodError): { field: string; message: string }[] {
  return error.errors.map((err) => ({
    field: err.path.join('.'),
    message: err.message,
  }));
}