import type { Request, Response, NextFunction } from 'express';
import { sanitizeInput } from '../sanitize';

describe('sanitizeInput middleware', () => {
  /**
   * Build a request whose `query` property is getter-only, mirroring
   * Express 5's actual behavior. This is the shape that broke prod
   * in the Express 4 -> 5 migration: assigning to req.query throws
   * TypeError in Express 5 because the property has no setter.
   */
  function makeReqWithGetterOnlyQuery(query: Record<string, unknown>, body?: Record<string, unknown>): Request {
    const req = {} as Request;
    Object.defineProperty(req, 'query', {
      get: () => query,
      configurable: true,
      enumerable: true,
    });
    if (body !== undefined) {
      (req as any).body = body;
    }
    return req;
  }

  it('does not throw when req.query is getter-only (Express 5 compat)', () => {
    const req = makeReqWithGetterOnlyQuery({ name: 'sita' });
    const res = {} as Response;
    const next = jest.fn() as unknown as NextFunction;

    expect(() => sanitizeInput(req, res, next)).not.toThrow();
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('strips dangerous keys from query', () => {
    const req = makeReqWithGetterOnlyQuery({ name: 'sita', __proto__: 'evil' });
    const res = {} as Response;
    const next = jest.fn() as unknown as NextFunction;

    sanitizeInput(req, res, next);

    expect((req.query as any).__proto__).not.toBe('evil');
    expect((req.query as any).name).toBe('sita');
  });

  it('sanitizes body in place', () => {
    const req = makeReqWithGetterOnlyQuery({}, { firstName: 'sita' });
    const res = {} as Response;
    const next = jest.fn() as unknown as NextFunction;

    expect(() => sanitizeInput(req, res, next)).not.toThrow();
    expect((req as any).body.firstName).toBe('sita');
  });
});
