/**
 * Pure helpers for the /api/og social-card route, extracted to @/lib so they
 * are unit-testable without pulling in next/og (Satori) at import time.
 */
import { DATE_REGEX, validateDate } from "@/lib/astro-types";
import { todayUtcString } from "@/lib/date";

/**
 * Validate a YYYY-MM-DD string. Returns the canonical date on success or
 * `null` for any failure (bad format, invalid calendar date, future date).
 * Falls back to today handled by the caller.
 */
export function parseOgDate(raw: string | null): string | null {
  if (!raw) return null;
  if (!DATE_REGEX.test(raw)) return null;
  const v = validateDate(raw);
  return v.valid ? v.date : null;
}

/** Resolve the card date: valid ?date= param, else today (UTC). */
export function resolveOgDate(raw: string | null): string {
  return parseOgDate(raw) ?? todayUtcString();
}

/**
 * Deterministic pseudo-random number generator (mulberry32) so the star field
 * stays stable across re-renders for the same date.
 */
export function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashSeed(str: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  }
  return h >>> 0;
}

export interface Star {
  x: number;
  y: number;
  size: number;
  opacity: number;
  tint: string;
}

/** Deterministic 110-star field for a given date string. */
export function buildStars(date: string): Star[] {
  const rng = makeRng(hashSeed(date));
  const stars: Star[] = [];
  const count = 110;
  for (let i = 0; i < count; i++) {
    const x = Math.floor(rng() * 1200);
    const y = Math.floor(rng() * 630);
    const sizeRoll = rng();
    const size = sizeRoll > 0.95 ? 3.5 : sizeRoll > 0.8 ? 2.4 : 1.4;
    const opacity = 0.3 + rng() * 0.7;
    const tint = rng() > 0.92 ? "#bfdbfe" : rng() > 0.85 ? "#fde68a" : "#ffffff";
    stars.push({ x, y, size, opacity, tint });
  }
  return stars;
}

/**
 * Cache-Control for the rendered card. Past dates are immutable → long CDN
 * cache; today is mutable (APOD publishes during the day) → short cache so
 * the card never goes stale for 24h.
 */
export function ogCacheControl(date: string): string {
  if (date === todayUtcString()) {
    return "public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400";
  }
  return "public, immutable, no-transform, max-age=86400, s-maxage=86400";
}
