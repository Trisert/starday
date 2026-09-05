import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  buildStars,
  hashSeed,
  makeRng,
  ogCacheControl,
  parseOgDate,
  resolveOgDate,
} from "@/lib/og-helpers";

describe("og-helpers", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-06-15T12:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("buildStars is deterministic: same date -> identical 110-star field", () => {
    const a = buildStars("2024-01-15");
    const b = buildStars("2024-01-15");
    expect(a).toHaveLength(110);
    expect(a).toEqual(b);
  });

  it("buildStars(\"2024-01-15\")[0] pinned coordinates (RNG draw order: x, y, sizeRoll, opacity, tint)", () => {
    expect(buildStars("2024-01-15")[0]).toEqual({
      x: 348,
      y: 200,
      size: 1.4,
      opacity: 0.8473368444480001,
      tint: "#fde68a",
    });
  });

  it("buildStars varies by date and stays in canvas bounds", () => {
    const stars = buildStars("1995-06-16");
    expect(stars).toHaveLength(110);
    for (const s of stars) {
      expect(s.x).toBeGreaterThanOrEqual(0);
      expect(s.x).toBeLessThan(1200);
      expect(s.y).toBeGreaterThanOrEqual(0);
      expect(s.y).toBeLessThan(630);
      expect(s.opacity).toBeGreaterThanOrEqual(0.3);
      expect(s.opacity).toBeLessThanOrEqual(1);
    }
    expect(stars).not.toEqual(buildStars("2024-01-15"));
  });

  it("parseOgDate accepts valid past dates, rejects garbage/future", () => {
    expect(parseOgDate("2024-01-15")).toBe("2024-01-15");
    expect(parseOgDate(null)).toBeNull();
    expect(parseOgDate("not-a-date")).toBeNull();
    expect(parseOgDate("2024-02-30")).toBeNull();
    expect(parseOgDate("2099-01-01")).toBeNull();
  });

  it("resolveOgDate falls back to today for missing/invalid input", () => {
    expect(resolveOgDate(null)).toBe("2024-06-15");
    expect(resolveOgDate("garbage")).toBe("2024-06-15");
    expect(resolveOgDate("2024-01-15")).toBe("2024-01-15");
  });

  it("ogCacheControl caches past dates long, today short", () => {
    expect(ogCacheControl("2024-01-15")).toContain("immutable");
    expect(ogCacheControl("2024-01-15")).toContain("max-age=86400");
    const today = ogCacheControl("2024-06-15");
    expect(today).not.toContain("immutable");
    expect(today).toContain("max-age=3600");
  });

  it("makeRng/hashSeed are stable", () => {
    expect(hashSeed("abc")).toBe(hashSeed("abc"));
    const rng = makeRng(42);
    const first = rng();
    expect(first).toBeGreaterThanOrEqual(0);
    expect(first).toBeLessThan(1);
  });
});
