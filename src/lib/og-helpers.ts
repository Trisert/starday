/**
 * Pure helpers for the /api/og social-card route, extracted to @/lib so they
 * are unit-testable without pulling in next/og (Satori) at import time.
 */
import { todayUtcString, validateDate } from "@/lib/date";

/** OG card dimensions (must match the ImageResponse size in the route). */
export const OG_WIDTH = 1200;
export const OG_HEIGHT = 630;

/** Number of stars in the deterministic background field. */
export const STAR_COUNT = 110;

/**
 * Validate a YYYY-MM-DD string. Returns the canonical date on success or
 * `null` for any failure (bad format, invalid calendar date, future date).
 * Falls back to today handled by the caller.
 */
export function parseOgDate(raw: string | null): string | null {
  if (!raw) return null;
  const v = validateDate(raw);
  return v.valid ? v.date : null;
}

/** Resolve the card date: valid ?date= param, else today (UTC). */
export function resolveOgDate(raw: string | null): string {
  return parseOgDate(raw) ?? todayUtcString();
}

/** 32-bit FNV-1a hash of a string. Used to seed the deterministic star field. */
export function hashSeed(str: string): number {
  let h = 0x811c9dc5; // FNV offset basis
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 0x01000193); // FNV prime
  }
  return h >>> 0;
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

export interface Star {
  readonly x: number;
  readonly y: number;
  readonly size: number;
  readonly opacity: number;
  readonly tint: string;
}

/** Star-size bracket boundaries, in roll order. */
const SIZE_ROLL_BIG = 0.95;
const SIZE_ROLL_MID = 0.8;
const STAR_BIG = 3.5;
const STAR_MID = 2.4;
const STAR_SMALL = 1.4;
const STAR_TINT_BLUE = 0.92;
const STAR_TINT_GOLD = 0.85;
const STAR_OPACITY_MIN = 0.3;
const STAR_OPACITY_RANGE = 0.7;

/** Deterministic 110-star field for a given date string. */
export function buildStars(date: string): Star[] {
  const rng = makeRng(hashSeed(date));
  const stars: Star[] = new Array(STAR_COUNT);
  for (let i = 0; i < STAR_COUNT; i++) {
    const x = Math.floor(rng() * OG_WIDTH);
    const y = Math.floor(rng() * OG_HEIGHT);
    const sizeRoll = rng();
    const size = sizeRoll > SIZE_ROLL_BIG ? STAR_BIG : sizeRoll > SIZE_ROLL_MID ? STAR_MID : STAR_SMALL;
    const opacity = STAR_OPACITY_MIN + rng() * STAR_OPACITY_RANGE;
    const tint = rng() > STAR_TINT_BLUE ? "#bfdbfe" : rng() > STAR_TINT_GOLD ? "#fde68a" : "#ffffff";
    stars[i] = { x, y, size, opacity, tint };
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
