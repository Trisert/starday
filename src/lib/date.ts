// Central date helpers - single source of truth for date logic.
// Used by @/lib/astro-types (re-exported for backwards compat), @/app/api/og, and @/app/api/astro.

/** Strict YYYY-MM-DD regex. */
export const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

/** Earliest date the API serves (YYYY-MM-DD): Sputnik 1, start of the space
 * age. Showing a "birthday photo" for earlier dates would be meaningless —
 * no space photography existed. Single source of truth for the API date
 * floor — the UI imports this. */
export const MIN_API_DATE = "1957-10-04";

/** Stable error codes (canonical definition — re-exported by astro-types). */
export type ErrorCode = "INVALID_DATE" | "RATE_LIMIT" | "NOT_FOUND" | "UPSTREAM_ERROR" | "CONFIG_ERROR";

/** Result of validateDate. */
type ValidateDateResult =
  | { valid: true; date: string }
  | { valid: false; error: string; code: ErrorCode };

const MS_PER_DAY = 1000 * 60 * 60 * 24;

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

/**
 * Return today's date as YYYY-MM-DD in UTC.
 */
export function todayUtcString(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Validate a YYYY-MM-DD date string.
 * - Format must match YYYY-MM-DD
 * - Must be a real calendar date
 * - Must not be in the future (relative to UTC today)
 * - Must not predate MIN_API_DATE (otherwise NASA Image Library would be
 *   queried with absurd `year_start` values).
 */
export function validateDate(date: string): ValidateDateResult {
  if (!DATE_REGEX.test(date)) {
    return {
      valid: false,
      error: "Invalid date format. Use YYYY-MM-DD.",
      code: "INVALID_DATE",
    };
  }
  const d = new Date(date + "T00:00:00Z");
  if (isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== date) {
    return { valid: false, error: "Invalid date.", code: "INVALID_DATE" };
  }
  // Sanity guard against absurd years (e.g. 0000/9999 would produce useless
  // `year_start=0000` NASA Image Library queries).
  if (date < MIN_API_DATE) {
    return {
      valid: false,
      error: "Invalid date. Must be 10/04/1957 or later (start of the space age).",
      code: "INVALID_DATE",
    };
  }
  const todayStr = todayUtcString();
  if (date > todayStr) {
    return {
      valid: false,
      error: "Date cannot be in the future.",
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
  return Math.abs(da - db) / MS_PER_DAY;
}

/**
 * Format a YYYY-MM-DD string as a long English display date (e.g. "April 15, 1990").
 * Falls back to the original string on any error.
 */
export function formatDisplayDate(iso: string): string {
  try {
    const [yStr, mStr, dStr] = iso.split("-");
    const y = Number(yStr);
    const m = Number(mStr);
    const d = Number(dStr);
    if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return iso;
    if (m < 1 || m > 12) return iso;
    return `${MONTH_NAMES[m - 1]} ${d}, ${y}`;
  } catch {
    return iso;
  }
}
