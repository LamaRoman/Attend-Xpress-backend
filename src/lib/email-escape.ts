/**
 * HTML escape helper for use in email templates.
 *
 * Every user-controlled value that gets interpolated into an HTML email body
 * MUST pass through h() first. This includes:
 *   - Names, employee IDs, PINs, org names, notes, reasons
 *   - Anything that originated from the database (since DB content may have
 *     been created before/without the sanitize middleware)
 *   - Anything sourced from HTTP request bodies
 *
 * Do NOT use h() on values we control (static strings, format strings,
 * numeric IDs, enum values). h() on those is harmless but noisy.
 *
 * URL fields (download links, reset links) get a different treatment —
 * see hUrl() below.
 */

const ESCAPE_MAP: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
  '/': '&#x2F;',
  '`': '&#x60;',
  '=': '&#x3D;',
};

/**
 * Escape a value for safe interpolation in HTML text or attribute context.
 * Accepts any type; numbers/booleans/Dates are stringified, null/undefined → ''.
 */
export function h(value: unknown): string {
  if (value === null || value === undefined) return '';
  const str = typeof value === 'string' ? value : String(value);
  return str.replace(/[&<>"'`/=]/g, (c) => ESCAPE_MAP[c] || c);
}

/**
 * Escape a URL for safe interpolation into an href="...".
 *
 * Only allows http(s): and mailto: schemes. Anything else becomes '#' — this
 * blocks javascript: and data: URLs that would otherwise execute in some
 * email clients.
 */
export function hUrl(url: unknown): string {
  if (typeof url !== 'string' || url.length === 0) return '#';
  const trimmed = url.trim();

  // Allow only known-safe schemes. Case-insensitive check.
  if (
    !/^https?:\/\//i.test(trimmed) &&
    !/^mailto:/i.test(trimmed)
  ) {
    return '#';
  }

  return h(trimmed);
}
