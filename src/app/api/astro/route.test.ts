import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { sanitiseCopyright } from "@/lib/astro-types";

// Use fake timers globally for deterministic today/cache/rate-limit
let ipCounter = 0;
function nextIp() {
  ipCounter += 1;
  return `10.0.${Math.floor(ipCounter / 256)}.${ipCounter % 256}`;
}

function makeNextRequest(
  url: string,
  opts: { method?: string; body?: unknown; ip?: string; headers?: Record<string, string> } = {}
) {
  const headers: Record<string, string> = {
    "x-forwarded-for": opts.ip ?? nextIp(),
    ...(opts.headers ?? {}),
  };
  const init: RequestInit & { headers: Record<string, string> } = {
    method: opts.method ?? "GET",
    headers,
  } as any;
  if (opts.body !== undefined) {
    headers["content-type"] = "application/json";
    (init as any).body = JSON.stringify(opts.body);
  }
  // NextRequest expects absolute URL
  const abs = url.startsWith("http") ? url : `http://localhost${url}`;
  return new NextRequest(abs, init as any);
}

function mockApodResponse(body: Record<string, unknown>, status = 200, ok = status >= 200 && status < 300) {
  return {
    ok,
    status,
    json: async () => body,
    headers: new Headers(),
  } as unknown as Response;
}

function mockFallbackResponse(items: unknown[]) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ collection: { items } }),
    headers: new Headers(),
  } as unknown as Response;
}

function fallbackItem(overrides: {
  title?: string;
  description?: string;
  date_created?: string;
  photographer?: string;
  href?: string;
} = {}) {
  return {
    data: [
      {
        title: overrides.title ?? "Hubble fallback image",
        description: overrides.description ?? "Fallback description",
        date_created: overrides.date_created ?? "2024-01-15T00:00:00Z",
        photographer: overrides.photographer ?? "NASA",
      },
    ],
    links: [{ href: overrides.href ?? "https://images-assets.nasa.gov/image/test/test~orig.jpg" }],
  };
}

describe("GET /api/astro - P0 critical", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-06-15T12:00:00Z"));
    process.env.NASA_API_KEY = "TEST_KEY";
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("GET missing date -> 400 INVALID_DATE", async () => {
    const { GET } = await import("./route");
    const req = makeNextRequest("/api/astro");
    const res = await GET(req);
    expect(res.status).toBe(400);
    const json: any = await res.json();
    expect(json.code).toBe("INVALID_DATE");
  });

  it("GET future date -> 400 INVALID_DATE", async () => {
    const { GET } = await import("./route");
    const req = makeNextRequest("/api/astro?date=2025-01-01");
    const res = await GET(req);
    expect(res.status).toBe(400);
    const json: any = await res.json();
    expect(json.code).toBe("INVALID_DATE");
  });

  it("APOD image 200 no fallback", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes("apod")) {
        return mockApodResponse({
          date: "2024-01-10",
          media_type: "image",
          hdurl: "https://apod.nasa.gov/image/2401/test.jpg",
          title: "Test Image",
          explanation: "A nice explanation",
          copyright: "J. Schmidt",
        });
      }
      // fallback should not be called
      return mockFallbackResponse([]);
    });
    vi.stubGlobal("fetch", fetchMock as any);
    const { GET } = await import("./route");
    const req = makeNextRequest("/api/astro?date=2024-01-10", { ip: nextIp() });
    const res = await GET(req);
    expect(res.status).toBe(200);
    const json: any = await res.json();
    expect(json.imageUrl).toBe("https://apod.nasa.gov/image/2401/test.jpg");
    expect(json.isFallback).toBe(false);
    expect(json.title).toBe("Test Image");
    // only 1 fetch (APOD), no fallback calls
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain("apod");
  });

  it("APOD video -> fallback 200", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes("apod")) {
        return mockApodResponse({
          date: "2024-02-10",
          media_type: "video",
          url: "https://www.youtube.com/embed/xyz",
          title: "Video Title",
          explanation: "video exp",
        });
      }
      if (String(url).includes("images-api.nasa.gov")) {
        return mockFallbackResponse([fallbackItem({ date_created: "2024-02-10T00:00:00Z" })]);
      }
      return mockFallbackResponse([]);
    });
    vi.stubGlobal("fetch", fetchMock as any);
    const { GET } = await import("./route");
    const req = makeNextRequest("/api/astro?date=2024-02-10");
    const res = await GET(req);
    expect(res.status).toBe(200);
    const json: any = await res.json();
    expect(json.isFallback).toBe(true);
    expect(json.imageUrl).toContain("https://images-assets.nasa.gov");
    expect(json.requestedDate).toBe("2024-02-10");
  });

  it("APOD 429 -> fallback ok", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes("apod")) {
        return mockApodResponse({ msg: "rate limit" }, 429, false);
      }
      if (String(url).includes("images-api.nasa.gov")) {
        return mockFallbackResponse([fallbackItem({ date_created: "2024-03-10T00:00:00Z" })]);
      }
      return mockFallbackResponse([]);
    });
    vi.stubGlobal("fetch", fetchMock as any);
    const { GET } = await import("./route");
    const req = makeNextRequest("/api/astro?date=2024-03-10");
    const res = await GET(req);
    expect(res.status).toBe(200);
    const json: any = await res.json();
    expect(json.isFallback).toBe(true);
  });

  it("APOD 429 -> fallback null -> 429", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes("apod")) {
        return mockApodResponse({ msg: "rate limit" }, 429, false);
      }
      if (String(url).includes("images-api.nasa.gov")) {
        return mockFallbackResponse([]); // no items
      }
      return mockFallbackResponse([]);
    });
    vi.stubGlobal("fetch", fetchMock as any);
    const { GET } = await import("./route");
    const req = makeNextRequest("/api/astro?date=2024-03-11");
    const res = await GET(req);
    expect(res.status).toBe(429);
    const json: any = await res.json();
    expect(json.code).toBe("RATE_LIMIT");
  });

  it("fetch throws -> 502 when fallback fails, 200 when fallback succeeds", async () => {
    // case A: fetch throws and fallback also empty -> 502
    {
      const fetchMock = vi.fn(async (url: string) => {
        if (String(url).includes("apod")) throw new Error("network down");
        return mockFallbackResponse([]);
      });
      vi.stubGlobal("fetch", fetchMock as any);
      const { GET } = await import("./route");
      const req = makeNextRequest("/api/astro?date=2024-04-01");
      const res = await GET(req);
      expect(res.status).toBe(502);
      const json: any = await res.json();
      expect(json.code).toBe("UPSTREAM_ERROR");
    }
    // case B: fetch throws but fallback succeeds -> 200
    {
      const fetchMock = vi.fn(async (url: string) => {
        if (String(url).includes("apod")) throw new Error("network down");
        if (String(url).includes("images-api.nasa.gov")) {
          return mockFallbackResponse([fallbackItem({ date_created: "2024-04-02T00:00:00Z" })]);
        }
        return mockFallbackResponse([]);
      });
      vi.stubGlobal("fetch", fetchMock as any);
      // need fresh module to avoid cache pollution for new date? same date differs
      vi.resetModules();
      // re-set env after reset
      process.env.NASA_API_KEY = "TEST_KEY";
      const { GET } = await import("./route");
      const req = makeNextRequest("/api/astro?date=2024-04-02");
      const res = await GET(req);
      expect(res.status).toBe(200);
      const json: any = await res.json();
      expect(json.isFallback).toBe(true);
    }
  });

  it("cache hit for past date, no-cache for today", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes("apod")) {
        return mockApodResponse({
          date: "2024-01-20",
          media_type: "image",
          hdurl: "https://apod.nasa.gov/cache_test.jpg",
          title: "Cache Test",
          explanation: "exp",
          copyright: "NASA",
        });
      }
      return mockFallbackResponse([]);
    });
    vi.stubGlobal("fetch", fetchMock as any);
    vi.resetModules();
    process.env.NASA_API_KEY = "TEST_KEY";
    const { GET } = await import("./route");

    // past date: first call caches, second call uses cache
    const ip1 = nextIp();
    const req1 = makeNextRequest("/api/astro?date=2024-01-20", { ip: ip1 });
    const res1 = await GET(req1);
    expect(res1.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // second request same past date, different IP to avoid rate limit, should be cached (no extra fetch)
    const req2 = makeNextRequest("/api/astro?date=2024-01-20", { ip: nextIp() });
    const res2 = await GET(req2);
    expect(res2.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1); // still 1

    // today should NOT be cached: two requests both hit fetch
    fetchMock.mockClear();
    const todayFetch = vi.fn(async (url: string) => {
      if (String(url).includes("apod")) {
        return mockApodResponse({
          date: "2024-06-15",
          media_type: "image",
          hdurl: "https://apod.nasa.gov/today.jpg",
          title: "Today",
          explanation: "today exp",
        });
      }
      return mockFallbackResponse([]);
    });
    vi.stubGlobal("fetch", todayFetch as any);
    // Need to use today date
    const t1 = makeNextRequest("/api/astro?date=2024-06-15", { ip: nextIp() });
    const tr1 = await GET(t1);
    expect(tr1.status).toBe(200);
    expect(todayFetch).toHaveBeenCalledTimes(1);
    const t2 = makeNextRequest("/api/astro?date=2024-06-15", { ip: nextIp() });
    const tr2 = await GET(t2);
    expect(tr2.status).toBe(200);
    expect(todayFetch).toHaveBeenCalledTimes(2);
  });

  it("rate limit 11 req same IP -> 429 on 11th", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      return mockApodResponse({
        date: "2024-01-05",
        media_type: "image",
        hdurl: "https://apod.nasa.gov/rate.jpg",
        title: "Rate",
        explanation: "exp",
      });
    });
    vi.stubGlobal("fetch", fetchMock as any);
    vi.resetModules();
    process.env.NASA_API_KEY = "TEST_KEY";
    const { GET } = await import("./route");
    const ip = "9.9.9.9";
    // Use different dates to avoid cache hit masking rate limit count? But cache would hide fetches.
    // Use same today? Better use distinct dates but same IP counts regardless.
    // To avoid cache, use today date which is not cached.
    for (let i = 0; i < 10; i++) {
      const req = makeNextRequest(`/api/astro?date=2024-06-15`, { ip });
      const res = await GET(req);
      expect(res.status).toBe(200);
    }
    const req11 = makeNextRequest(`/api/astro?date=2024-06-15`, { ip });
    const res11 = await GET(req11);
    expect(res11.status).toBe(429);
    const json: any = await res11.json();
    expect(json.code).toBe("RATE_LIMIT");
    expect(res11.headers.get("X-RateLimit-Remaining")).toBe("0");
  });

  it("POST json ok -> 200", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes("apod")) {
        return mockApodResponse({
          date: "2024-05-01",
          media_type: "image",
          hdurl: "https://apod.nasa.gov/post.jpg",
          title: "Post Title",
          explanation: "post exp",
        });
      }
      return mockFallbackResponse([]);
    });
    vi.stubGlobal("fetch", fetchMock as any);
    vi.resetModules();
    process.env.NASA_API_KEY = "TEST_KEY";
    const { POST } = await import("./route");
    const req = makeNextRequest("/api/astro", { method: "POST", body: { date: "2024-05-01" } });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const json: any = await res.json();
    expect(json.title).toBe("Post Title");
    expect(json.isFallback).toBe(false);
  });

  it("sanitise boundary 120 keeps, 121 falls back to NASA/ESA/STScI", async () => {
    expect(sanitiseCopyright("x".repeat(120))).toBe("x".repeat(120));
    expect(sanitiseCopyright("x".repeat(121))).toBe("NASA/ESA/STScI");
    // also via route: APOD copyright long -> creditedTo fallback
    const longCopyright = "y".repeat(121);
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes("apod")) {
        return mockApodResponse({
          date: "2024-01-25",
          media_type: "image",
          hdurl: "https://apod.nasa.gov/boundary.jpg",
          title: "Boundary",
          explanation: "exp",
          copyright: longCopyright,
        });
      }
      return mockFallbackResponse([]);
    });
    vi.stubGlobal("fetch", fetchMock as any);
    vi.resetModules();
    process.env.NASA_API_KEY = "TEST_KEY";
    const { GET } = await import("./route");
    const req = makeNextRequest("/api/astro?date=2024-01-25");
    const res = await GET(req);
    expect(res.status).toBe(200);
    const json: any = await res.json();
    expect(json.creditedTo).toBe("NASA/ESA/STScI");

    // 120 case
    const okCopyright = "z".repeat(120);
    const fetchMock2 = vi.fn(async (url: string) => {
      if (String(url).includes("apod")) {
        return mockApodResponse({
          date: "2024-01-26",
          media_type: "image",
          hdurl: "https://apod.nasa.gov/boundary2.jpg",
          title: "Boundary2",
          explanation: "exp",
          copyright: okCopyright,
        });
      }
      return mockFallbackResponse([]);
    });
    vi.stubGlobal("fetch", fetchMock2 as any);
    const req2 = makeNextRequest("/api/astro?date=2024-01-26");
    const res2 = await GET(req2);
    expect(res2.status).toBe(200);
    const json2: any = await res2.json();
    expect(json2.creditedTo).toBe(okCopyright);
  });
});
