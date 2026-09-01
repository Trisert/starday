// Shared types and helpers for the NASA APOD + fallback API.
// Used by src/app/api/astro/route.ts (server) and src/app/page.tsx (client).

/**
 * Shape of a successful APOD / NASA Image Library fallback response.
 */
export interface AstroSuccess {
  imageUrl: string;
  title: string;
  caption: string;
  source: string;
  creditedTo: string;
  actualDate: string;
  isFallback: boolean;
  requestedDate: string;
}

/**
 * Shape of an error response body.
 */
export interface AstroErrorBody {
  error: string;
  code: ErrorCode;
}

/**
 * Discriminated-ish union returned from /api/astro.
 * Note: the wire shape does NOT include a discriminator field, so consumers
 * type-narrow by checking for `error` vs `imageUrl`.
 */
export type AstroResult = AstroSuccess | AstroErrorBody;

/**
 * Stable error codes returned in AstroErrorBody.code.
 */
export type ErrorCode =
  | "INVALID_DATE"
  | "RATE_LIMIT"
  | "NOT_FOUND"
  | "UPSTREAM_ERROR"
  | "CONFIG_ERROR";

/**
 * First APOD date — used as a hint for the minimum valid date input.
 * Fallback logic in the route still accepts earlier dates for graceful UX,
 * but the official APOD archive starts here.
 */
export const MIN_APOD_DATE = "1995-06-16";

/**
 * Strict YYYY-MM-DD regex used to validate user-supplied dates.
 */
export const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Validate a YYYY-MM-DD date string.
 * Returns `{ valid: true, date }` on success, otherwise an Italian-localized
 * error message plus a stable ErrorCode.
 *
 * Rules:
 * - Format must match YYYY-MM-DD.
 * - Must be a real calendar date (e.g. 2024-02-30 is rejected).
 * - Must not be in the future (relative to UTC "today").
 *
 * Note: dates before MIN_APOD_DATE are accepted here — the route tries the
 * NASA Image Library fallback for older dates. The client form enforces the
 * min separately via the input's `min` attribute.
 */
export function validateDate(
  date: string
): { valid: true; date: string } | { valid: false; error: string; code: ErrorCode } {
  if (!DATE_REGEX.test(date)) {
    return {
      valid: false,
      error: "Formato data non valido. Usa YYYY-MM-DD.",
      code: "INVALID_DATE",
    };
  }
  const d = new Date(date + "T00:00:00Z");
  if (isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== date) {
    return { valid: false, error: "Data non valida.", code: "INVALID_DATE" };
  }
  // Non-future check (UTC).
  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10);
  if (date > todayStr) {
    return {
      valid: false,
      error: "La data non può essere nel futuro.",
      code: "INVALID_DATE",
    };
  }
  return { valid: true, date };
}

/**
 * Absolute day difference between two YYYY-MM-DD strings.
 * Uses UTC midnight anchors to avoid DST drift. Returned as a number of
 * whole days (may be fractional if inputs cross a DST boundary — callers
 * compare with `<` so non-integer results still rank correctly).
 */
export function daysDiff(a: string, b: string): number {
  const da = new Date(a + "T00:00:00Z").getTime();
  const db = new Date(b + "T00:00:00Z").getTime();
  return Math.abs(da - db) / (1000 * 60 * 60 * 24);
}

/**
 * Detect whether a URL points to a raw or FITS asset that the browser can't
 * render as an `<img>`. Used by the route to fall back to NASA Image Library
 * instead of returning an un-viewable asset.
 *
 * Matches:
 * - `.fit` or `.fits` extension (case-insensitive), followed by end-of-string,
 *   query, or fragment.
 * - `.raw` extension, same boundary rules.
 * - `raw` as a query parameter value (e.g. `?raw=1`, `?format=raw`).
 * - `/raw/` or `/raw` path segment.
 *
 * Deliberately does NOT match unrelated substrings like `rawr-image.jpg` —
 * the `raw` pattern is anchored to a path/query boundary.
 */
export function isRawOrFits(url: string): boolean {
  if (/\.fits?(\?|#|$)/i.test(url)) return true;
  if (/\.raw(\?|#|$)/i.test(url)) return true;
  if (/[?&]raw(?:=|&|$)/i.test(url)) return true;
  if (/\/raw(?:\/|$)/i.test(url)) return true;
  return false;
}

/**
 * Normalise the NASA APOD `copyright` field into a clean "credited to" string.
 * Some APOD entries have a non-person copyright like "solar cycle 25",
 * "ESA/Hubble & NASA, J. Schmidt", or even campaign/mission names.
 * Heuristic:
 * - Empty / missing → "NASA"
 * - More than 120 chars (likely a description) → "NASA/ESA/STScI"
 * - Contains common mission/campaign/solar keywords → "NASA/ESA/STScI"
 * - Otherwise the original string.
 */
const COPYRIGHT_FALLBACK = "NASA/ESA/STScI";
// Strict: only true mission/campaign descriptors, NOT telescope acronyms that
// legitimately appear in a credit like "NASA/ESA Hubble" or "JWST Team".
const MISSION_KEYWORDS =
  /\b(solar\s+cycle|sdo|aia|lasco|soho|epic|terra|aqua)\b/i;
const COPYRIGHT_MAX = 120;

export function sanitiseCopyright(raw: string | undefined | null): string {
  if (!raw) return "NASA";
  const trimmed = raw.trim();
  if (!trimmed) return "NASA";
  if (trimmed.length > COPYRIGHT_MAX) return COPYRIGHT_FALLBACK;
  if (MISSION_KEYWORDS.test(trimmed)) return COPYRIGHT_FALLBACK;
  return trimmed;
}