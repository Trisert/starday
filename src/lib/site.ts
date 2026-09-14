/**
 * Single source of truth for the site URL used by canonical/OG metadata,
 * sitemap.xml, robots.txt and share links.
 *
 * Resolution order (first non-empty, valid value wins):
 *   1. NEXT_PUBLIC_SITE_URL          — explicit override (set in the Vercel project)
 *   2. VERCEL_PROJECT_PRODUCTION_URL — Vercel's stable production domain (no scheme)
 *   3. VERCEL_URL                    — the current deployment domain (no scheme)
 *   4. http://localhost:3000         — local development fallback
 *
 * Values are normalized: trimmed, given an explicit scheme when missing, and
 * stripped of the trailing slash. No domain is hardcoded.
 */

const LOCAL_SITE_URL = "http://localhost:3000";

/** Trim, add a missing scheme, drop trailing slashes. Invalid values -> null. */
function normalizeSiteUrl(value: string | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(withScheme);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
  } catch {
    return null;
  }
}

/** Resolve the site URL (absolute, no trailing slash). */
export function resolveSiteUrl(): string {
  return (
    normalizeSiteUrl(process.env.NEXT_PUBLIC_SITE_URL) ??
    normalizeSiteUrl(process.env.VERCEL_PROJECT_PRODUCTION_URL) ??
    normalizeSiteUrl(process.env.VERCEL_URL) ??
    LOCAL_SITE_URL
  );
}

/** Host (with port when present) of the resolved site URL — e.g. for the OG card. */
export function siteHost(): string {
  return new URL(resolveSiteUrl()).host;
}
