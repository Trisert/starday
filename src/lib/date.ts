// Central date helpers - single source of truth for date logic.
// Used by @/lib/astro-types (re-exported for backwards compat), @/app/api/og, and @/app/api/astro.

/** Strict YYYY-MM-DD regex. */
export const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

/** Minimum year for APOD archive (1995). */
export const MIN_YEAR = 1995;

/** Stable error codes (mirrors astro-types for standalone usage without circular import). */
export type ErrorCode = "INVALID_DATE" | "RATE_LIMIT" | "NOT_FOUND" | "UPSTREAM_ERROR" | "CONFIG_ERROR";

/**
 * Return today's date as YYYY-MM-DD in UTC.
 */
export function todayUtcString(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * True if the given YYYY-MM-DD string is strictly before today (UTC).
 * Returns false for today and future dates.
 */
export function isPastDate(date: string): boolean {
  return date < todayUtcString();
}

/**
 * Validate a YYYY-MM-DD date string.
 * - Format must match YYYY-MM-DD
 * - Must be a real calendar date
 * - Must not be in the future (relative to UTC today)
 * Dates before MIN_YEAR / MIN_APOD_DATE are accepted (fallback path handles them).
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
  // Optional MIN_YEAR guard — exported constant for consumers, but validator remains permissive
  // for fallback UX (pre-1995 dates are still valid here, route tries Image Library).
  // Uncomment to enforce strict cutoff: if (Number(date.slice(0,4)) < MIN_YEAR) { return ... }
  const todayStr = todayUtcString();
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
 * Uses UTC midnight anchors to avoid DST drift.
 */
export function daysDiff(a: string, b: string): number {
  const da = new Date(a + "T00:00:00Z").getTime();
  const db = new Date(b + "T00:00:00Z").getTime();
  return Math.abs(da - db) / (1000 * 60 * 60 * 24);
}

/**
 * Format a YYYY-MM-DD string as a long Italian date (e.g. "15 aprile 1990").
 * Falls back to the original string on any error.
 */
export function formatItalianDate(iso: string): string {
  try {
    const [yStr, mStr, dStr] = iso.split("-");
    const y = Number(yStr);
    const m = Number(mStr);
    const d = Number(dStr);
    const months = [
      "gennaio",
      "febbraio",
      "marzo",
      "aprile",
      "maggio",
      "giugno",
      "luglio",
      "agosto",
      "settembre",
      "ottobre",
      "novembre",
      "dicembre",
    ];
    if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return iso;
    if (m < 1 || m > 12) return iso;
    return `${d} ${months[m - 1]} ${y}`;
  } catch {
    return iso;
  }
}
