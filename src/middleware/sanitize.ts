import { Request, Response, NextFunction } from 'express';

/**
 * Prototype-pollution protection for incoming request bodies and query strings.
 *
 * WHY THIS EXISTS
 * ───────────────
 * Some JSON parsers or downstream code paths can merge user-supplied keys into
 * plain objects. If an attacker includes "__proto__", "constructor", or
 * "prototype" as keys, they can pollute Object.prototype and alter behaviour
 * elsewhere in the process (CVE pattern, CWE-1321). We strip these keys at
 * ingress defensively even though modern Node/Express + our code paths mostly
 * resist it.
 *
 * WHAT THIS USED TO DO (and why we stopped)
 * ─────────────────────────────────────────
 * An earlier version of this middleware also tried to strip <script> tags,
 * javascript: URIs, and onFOO= event handlers from every string. That was
 * removed because:
 *   1. It corrupts legitimate data — e.g. a note like "fixed on Friday" was
 *      having "on " stripped by the on\w+= rule.
 *   2. It provides false assurance. The regex catches naive XSS payloads
 *      but any real attacker can bypass it with encodings, nested tags, or
 *      SVG event handlers.
 *   3. XSS is an OUTPUT-CONTEXT problem, not an input-context one.
 *      React/Next.js escape by default; our email HTML templates now use
 *      escapeHtml() at interpolation (see email.service.ts).
 *
 * If you're adding a new render surface (server-side HTML templating,
 * SVG output, PDF text from user input, etc.) the escape belongs there,
 * not here.
 */

const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function deepCleanKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(deepCleanKeys);

  if (value !== null && typeof value === 'object') {
    const clean: Record<string, unknown> = Object.create(null);
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (DANGEROUS_KEYS.has(k)) continue;
      clean[k] = deepCleanKeys(v);
    }
    return clean;
  }

  if (typeof value === 'string') return value.trim();

  return value;
}

export const sanitizeInput = (req: Request, _res: Response, next: NextFunction) => {
  if (req.body && typeof req.body === 'object') {
    req.body = deepCleanKeys(req.body);
  }

  if (req.query && typeof req.query === 'object') {
    const clean: Record<string, unknown> = Object.create(null);
    for (const [k, v] of Object.entries(req.query as Record<string, unknown>)) {
      if (DANGEROUS_KEYS.has(k)) continue;
      clean[k] = deepCleanKeys(v);
    }
    Object.defineProperty(req, 'query', {
      value: clean,
      writable: true,
      configurable: true,
      enumerable: true,
    });
  }

  next();
};
