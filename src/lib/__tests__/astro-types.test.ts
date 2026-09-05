import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  MIN_APOD_DATE,
  DATE_REGEX,
  validateDate,
  daysDiff,
  isRawOrFits,
  sanitiseCopyright,
  type AstroSuccess,
  type AstroErrorBody,
  type ErrorCode,
} from "@/lib/astro-types";

describe("constants", () => {
  it("MIN_APOD_DATE matches the APOD archive start", () => {
    expect(MIN_APOD_DATE).toBe("1995-06-16");
  });

  it("DATE_REGEX matches YYYY-MM-DD", () => {
    expect(DATE_REGEX.test("1995-06-16")).toBe(true);
    expect(DATE_REGEX.test("2024-02-29")).toBe(true);
    expect(DATE_REGEX.test("9999-12-31")).toBe(true);
  });

  it("DATE_REGEX rejects malformed dates", () => {
    expect(DATE_REGEX.test("")).toBe(false);
    expect(DATE_REGEX.test("1995/06/16")).toBe(false);
    expect(DATE_REGEX.test("95-06-16")).toBe(false);
    expect(DATE_REGEX.test("1995-6-16")).toBe(false);
    expect(DATE_REGEX.test("1995-06-16T00:00:00Z")).toBe(false);
    expect(DATE_REGEX.test("not-a-date")).toBe(false);
  });
});

describe("validateDate", () => {
  // Pin "now" so future/today tests are deterministic.
  // Use a UTC noon time on 2024-06-15 so todayStr = "2024-06-15" regardless of TZ.
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-06-15T12:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("accepts a valid historical date", () => {
    const r = validateDate("2000-01-01");
    expect(r).toEqual({ valid: true, date: "2000-01-01" });
  });

  it("accepts exactly MIN_APOD_DATE (first APOD)", () => {
    const r = validateDate(MIN_APOD_DATE);
    expect(r.valid).toBe(true);
    if (r.valid) expect(r.date).toBe(MIN_APOD_DATE);
  });

  it("accepts exactly today's date", () => {
    const r = validateDate("2024-06-15");
    expect(r.valid).toBe(true);
    if (r.valid) expect(r.date).toBe("2024-06-15");
  });

  it("rejects a future date", () => {
    const r = validateDate("2099-12-31");
    expect(r.valid).toBe(false);
    if (!r.valid) {
      expect(r.code).toBe("INVALID_DATE");
      expect(r.error).toMatch(/future/i);
    }
  });

  it("rejects a date one day in the future", () => {
    const r = validateDate("2024-06-16");
    expect(r.valid).toBe(false);
    if (!r.valid) expect(r.code).toBe("INVALID_DATE");
  });

  it("rejects bad format", () => {
    const r = validateDate("2024/06/15");
    expect(r.valid).toBe(false);
    if (!r.valid) {
      expect(r.code).toBe("INVALID_DATE");
      expect(r.error).toMatch(/format/i);
    }
  });

  it("rejects empty string", () => {
    const r = validateDate("");
    expect(r.valid).toBe(false);
    if (!r.valid) expect(r.code).toBe("INVALID_DATE");
  });

  it("rejects non-string-ish garbage", () => {
    const r = validateDate("hello-world");
    expect(r.valid).toBe(false);
    if (!r.valid) expect(r.code).toBe("INVALID_DATE");
  });

  it("rejects impossible calendar date Feb 30", () => {
    // Date(2024-02-30T00:00:00Z) rolls forward to 2024-03-01, so the round-trip
    // check catches it.
    const r = validateDate("2024-02-30");
    expect(r.valid).toBe(false);
    if (!r.valid) {
      expect(r.code).toBe("INVALID_DATE");
      expect(r.error).toMatch(/invalid date/i);
    }
  });

  it("rejects Feb 29 in a non-leap year", () => {
    const r = validateDate("2023-02-29");
    expect(r.valid).toBe(false);
    if (!r.valid) expect(r.code).toBe("INVALID_DATE");
  });

  it("accepts Feb 29 in a leap year", () => {
    const r = validateDate("2024-02-29");
    expect(r.valid).toBe(true);
    if (r.valid) expect(r.date).toBe("2024-02-29");
  });

  it("rejects month 13", () => {
    const r = validateDate("2024-13-01");
    expect(r.valid).toBe(false);
    if (!r.valid) expect(r.code).toBe("INVALID_DATE");
  });

  it("rejects day 32", () => {
    const r = validateDate("2024-01-32");
    expect(r.valid).toBe(false);
    if (!r.valid) expect(r.code).toBe("INVALID_DATE");
  });

  it("accepts dates before MIN_APOD_DATE (fallback path is route's responsibility)", () => {
    // The route still tries NASA Image Library fallback for these, so the
    // validator must not block them — only the client form does.
    const r = validateDate("1990-04-24");
    expect(r.valid).toBe(true);
    if (r.valid) expect(r.date).toBe("1990-04-24");
  });

  it("ErrorCode union covers all expected values", () => {
    const codes: ErrorCode[] = [
      "INVALID_DATE",
      "RATE_LIMIT",
      "NOT_FOUND",
      "UPSTREAM_ERROR",
      "CONFIG_ERROR",
    ];
    // Sanity: exhaustiveness — every code is a valid ErrorCode literal.
    for (const c of codes) {
      expect(typeof c).toBe("string");
    }
  });
});

describe("daysDiff", () => {
  it("returns 0 for the same day", () => {
    expect(daysDiff("2024-06-15", "2024-06-15")).toBe(0);
  });

  it("returns 1 for one day apart", () => {
    expect(daysDiff("2024-06-15", "2024-06-16")).toBe(1);
  });

  it("returns 1 regardless of argument order (absolute value)", () => {
    expect(daysDiff("2024-06-16", "2024-06-15")).toBe(1);
  });

  it("crosses a leap day correctly (Feb 28 -> Mar 1 in 2024 = 2 days)", () => {
    expect(daysDiff("2024-02-28", "2024-03-01")).toBe(2);
  });

  it("crosses a leap day correctly (Feb 28 -> Mar 1 in 2023 = 1 day)", () => {
    // Non-leap year: Feb has 28 days.
    expect(daysDiff("2023-02-28", "2023-03-01")).toBe(1);
  });

  it("crosses a year boundary (Dec 31 -> Jan 1 = 1 day)", () => {
    expect(daysDiff("2023-12-31", "2024-01-01")).toBe(1);
  });

  it("crosses a year boundary (Dec 31, 1999 -> Jan 1, 2000 = 1 day)", () => {
    expect(daysDiff("1999-12-31", "2000-01-01")).toBe(1);
  });

  it("returns 365 for a non-leap-year gap", () => {
    expect(daysDiff("2023-01-01", "2024-01-01")).toBe(365);
  });

  it("returns 366 for a leap-year gap (2024 is a leap year)", () => {
    expect(daysDiff("2024-01-01", "2025-01-01")).toBe(366);
  });

  it("returns 10592 days for 1995-06-16 to 2024-06-15 (29y, 7 leap days)", () => {
    // 29 * 365 = 10585 + leap days in (1996, 2000, 2004, 2008, 2012, 2016, 2020) = 7 → 10592
    expect(daysDiff("1995-06-16", "2024-06-15")).toBe(10592);
  });
});

describe("isRawOrFits", () => {
  describe("matches", () => {
    it("matches .fits extension", () => {
      expect(isRawOrFits("https://example.com/image.fits")).toBe(true);
    });

    it("matches .fit (short) extension", () => {
      expect(isRawOrFits("https://example.com/image.fit")).toBe(true);
    });

    it("matches .FITS (uppercase) extension", () => {
      expect(isRawOrFits("https://example.com/image.FITS")).toBe(true);
    });

    it("matches .FIT (uppercase short) extension", () => {
      expect(isRawOrFits("https://example.com/image.FIT")).toBe(true);
    });

    it("matches .fits before a query string", () => {
      expect(isRawOrFits("https://example.com/image.fits?token=abc")).toBe(true);
    });

    it("matches .fits before a fragment", () => {
      expect(isRawOrFits("https://example.com/image.fits#section")).toBe(true);
    });

    it("matches .fits extension even when other query params are present", () => {
      expect(isRawOrFits("https://example.com/image.fits?type=original&quality=hd")).toBe(true);
    });

    it("matches raw=1 query param", () => {
      expect(isRawOrFits("https://example.com/image.jpg?raw=1")).toBe(true);
    });

    it("matches raw= in the middle of a query", () => {
      expect(isRawOrFits("https://example.com/image.jpg?foo=bar&raw=true&baz=qux")).toBe(true);
    });

    it("matches .raw extension", () => {
      expect(isRawOrFits("https://example.com/image.raw")).toBe(true);
    });

    it("matches /raw/ path segment", () => {
      expect(isRawOrFits("https://example.com/raw/image.jpg")).toBe(true);
    });

    it("matches /raw at end of path", () => {
      expect(isRawOrFits("https://example.com/some/raw")).toBe(true);
    });
  });

  describe("does NOT match (false positives must not trigger)", () => {
    it("does not match rawr-image.jpg (raw inside word)", () => {
      expect(isRawOrFits("https://example.com/rawr-image.jpg")).toBe(false);
    });

    it("does not match a normal .jpg URL", () => {
      expect(isRawOrFits("https://example.com/photo.jpg")).toBe(false);
    });

    it("does not match a normal .png URL", () => {
      expect(isRawOrFits("https://example.com/photo.png")).toBe(false);
    });

    it("does not match a normal .jpeg URL", () => {
      expect(isRawOrFits("https://example.com/photo.jpeg")).toBe(false);
    });

    it("does not match a normal .webp URL", () => {
      expect(isRawOrFits("https://example.com/photo.webp")).toBe(false);
    });

    it("does not match a NASA APOD-style URL", () => {
      expect(
        isRawOrFits("https://apod.nasa.gov/apod/image/2401/hubble_spiral_ngc_1672_960.jpg")
      ).toBe(false);
    });

    it("does not match a URL where 'raw' is part of a longer word", () => {
      expect(isRawOrFits("https://example.com/drawing-tool.jpg")).toBe(false);
      expect(isRawOrFits("https://example.com/crawl-stats.png")).toBe(false);
      expect(isRawOrFits("https://example.com/strawberry.jpg")).toBe(false);
    });

    it("does not match empty string", () => {
      expect(isRawOrFits("")).toBe(false);
    });

    it("does not match a URL with .fit substring inside a longer word", () => {
      // ".fitness" contains "fit" but not ".fit" followed by EOL/?/#
      expect(isRawOrFits("https://example.com/fitness.jpg")).toBe(false);
    });
  });
});

describe("type contracts", () => {
  // Compile-time only — these assertions are sanity checks that the types
  // can be assigned the shapes we expect.
  it("AstroSuccess shape is assignable", () => {
    const s: AstroSuccess = {
      imageUrl: "https://x/y.jpg",
      title: "t",
      caption: "c",
      source: "NASA APOD",
      creditedTo: "NASA",
      actualDate: "2024-06-15",
      isFallback: false,
      requestedDate: "2024-06-15",
    };
    expect(s.isFallback).toBe(false);
  });

  it("AstroErrorBody shape is assignable", () => {
    const e: AstroErrorBody = { error: "boom", code: "UPSTREAM_ERROR" };
    expect(e.code).toBe("UPSTREAM_ERROR");
  });
});

describe("sanitiseCopyright", () => {
  it("returns 'NASA' for empty / nullish / whitespace input", () => {
    expect(sanitiseCopyright(undefined)).toBe("NASA");
    expect(sanitiseCopyright(null)).toBe("NASA");
    expect(sanitiseCopyright("")).toBe("NASA");
    expect(sanitiseCopyright("   ")).toBe("NASA");
  });

  it("returns 'NASA/ESA/STScI' for solar-cycle style strings (real upstream case)", () => {
    expect(sanitiseCopyright("solar cycle 25")).toBe("NASA/ESA/STScI");
    expect(sanitiseCopyright("SDO / AIA")).toBe("NASA/ESA/STScI");
  });

  it("returns 'NASA/ESA/STScI' for too-long strings (likely description)", () => {
    const long = "x".repeat(121);
    expect(sanitiseCopyright(long)).toBe("NASA/ESA/STScI");
  });

  it("passes through clean person-like credits", () => {
    expect(sanitiseCopyright("J. Schmidt")).toBe("J. Schmidt");
    expect(sanitiseCopyright("NASA, ESA and the Hubble Heritage Team")).toBe(
      "NASA, ESA and the Hubble Heritage Team"
    );
  });

  it("trims surrounding whitespace", () => {
    expect(sanitiseCopyright("  ESA/Hubble  ")).toBe("ESA/Hubble");
  });
});
