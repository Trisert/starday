// Shared types and helpers for the NASA APOD + fallback API.
// Used by src/app/api/astro/route.ts (server) and src/app/page.tsx (client).

import type { ErrorCode } from "./date";

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

// Canonical definition lives in ./date (single source of truth).
export type { ErrorCode };

/**
 * First APOD date — used as a hint for the minimum valid date input.
 * Fallback logic in the route still accepts earlier dates for graceful UX,
 * but the official APOD archive starts here.
 */
export const MIN_APOD_DATE = "1995-06-16";

// Centralized date helpers — single source of truth lives in ./date, re-exported
// here for backwards compat (route.ts and other consumers import from
// @/lib/astro-types).
export {
  DATE_REGEX,
  MIN_API_DATE,
  todayUtcString,
  daysDiff,
  validateDate,
  formatDisplayDate,
} from "./date";

const FITS_RE = /\.fits?(\?|#|$)/i;
const RAW_EXT_RE = /\.raw(\?|#|$)/i;
const RAW_PARAM_RE = /[?&]raw(?:=|&|$)/i;
const RAW_SEGMENT_RE = /\/raw(?:\/|$)/i;

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
  return FITS_RE.test(url) || RAW_EXT_RE.test(url) || RAW_PARAM_RE.test(url) || RAW_SEGMENT_RE.test(url);
}

const COPYRIGHT_FALLBACK = "NASA/ESA/STScI";
// Strict: only true mission/campaign descriptors, NOT telescope acronyms that
// legitimately appear in a credit like "NASA/ESA Hubble" or "JWST Team".
const MISSION_KEYWORDS = /\b(solar\s+cycle|sdo|aia|lasco|soho|epic|terra|aqua)\b/i;
const COPYRIGHT_MAX = 120;

/**
 * Normalise the NASA APOD `copyright` field into a clean "credited to" string.
 * Some APOD entries have a non-person copyright like "solar cycle 25",
 * "ESA/Hubble & NASA, J. Schmidt", or even campaign/mission names.
 * Heuristic:
 * - Empty / missing → "NASA"
 * - More than 120 chars (likely a description) → "NASA/ESA/STScI"
 * - Contains common mission/campaign/solar keywords → "NASA/ESA/STScI"
 * - Otherwise the original string, trimmed.
 * NOTE: no HTML-escaping here — consumers render this as React text (which
 * escapes automatically). Escaping at this layer double-escapes in the UI
 * ("A & B" would render as "A &amp; B").
 */
export function sanitiseCopyright(raw: string | undefined | null): string {
  if (!raw) return "NASA";
  const trimmed = raw.trim();
  if (!trimmed) return "NASA";
  if (trimmed.length > COPYRIGHT_MAX) return COPYRIGHT_FALLBACK;
  if (MISSION_KEYWORDS.test(trimmed)) return COPYRIGHT_FALLBACK;
  return trimmed;
}
