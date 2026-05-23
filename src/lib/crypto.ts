import crypto from 'crypto';

// ============================================================
// QR Token Generation & Payload Parsing
//
// History: earlier versions of this file also HMAC-signed the token
// with QR_SECRET and embedded the signature in the QR URL. That check
// was removed in PR 6 — the signature was stored next to the token in
// the same DB row and offered no real defense: a UUID v4 token already
// has 122 bits of entropy, and DB lookup against qr_codes is the real
// authorization check. The HMAC only mattered if an attacker had read
// access to the DB, in which case they had the signature too.
//
// The parseQRPayload() function still tolerates old-format payloads
// that include a `signature` field, so printed QRs from before PR 6
// keep working. The signature value is discarded.
// ============================================================

// Generate a random token for QR code
export function generateQRToken(): string {
  return crypto.randomUUID();
}

// Create QR payload (what gets encoded in the QR code)
export function createQRPayload(token: string): string {
  return JSON.stringify({ token });
}

// Parse QR payload. Accepts:
//   - New format:  {"token":"<uuid>"}
//   - Old format:  {"token":"<uuid>","signature":"<hex>"}  (signature ignored)
export function parseQRPayload(
  payload: string
): { token: string } | null {
  try {
    const parsed = JSON.parse(payload);
    if (typeof parsed.token === 'string') {
      return { token: parsed.token };
    }
    return null;
  } catch {
    return null;
  }
}
