import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resolveSiteUrl, siteHost } from "../site";

const SITE_ENV_KEYS = [
  "NEXT_PUBLIC_SITE_URL",
  "VERCEL_PROJECT_PRODUCTION_URL",
  "VERCEL_URL",
] as const;

let savedEnv: Record<string, string | undefined>;

beforeEach(() => {
  savedEnv = Object.fromEntries(SITE_ENV_KEYS.map((key) => [key, process.env[key]]));
  for (const key of SITE_ENV_KEYS) delete process.env[key];
});

afterEach(() => {
  for (const key of SITE_ENV_KEYS) {
    const value = savedEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("resolveSiteUrl", () => {
  it("falls back to localhost when no site env is set", () => {
    expect(resolveSiteUrl()).toBe("http://localhost:3000");
  });

  it("prefers NEXT_PUBLIC_SITE_URL over the Vercel fallbacks", () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://example.test";
    process.env.VERCEL_PROJECT_PRODUCTION_URL = "starday-prod.vercel.app";
    process.env.VERCEL_URL = "starday-abc123.vercel.app";
    expect(resolveSiteUrl()).toBe("https://example.test");
  });

  it("falls back to VERCEL_PROJECT_PRODUCTION_URL and adds the missing scheme", () => {
    process.env.VERCEL_PROJECT_PRODUCTION_URL = "starday-ashy.vercel.app";
    process.env.VERCEL_URL = "starday-abc123.vercel.app";
    expect(resolveSiteUrl()).toBe("https://starday-ashy.vercel.app");
  });

  it("falls back to VERCEL_URL when the project production URL is absent", () => {
    process.env.VERCEL_URL = "starday-abc123.vercel.app";
    expect(resolveSiteUrl()).toBe("https://starday-abc123.vercel.app");
  });

  it("trims whitespace and strips trailing slashes", () => {
    process.env.NEXT_PUBLIC_SITE_URL = "  https://example.test/  ";
    expect(resolveSiteUrl()).toBe("https://example.test");
  });

  it("treats blank values as unset", () => {
    process.env.NEXT_PUBLIC_SITE_URL = "   ";
    process.env.VERCEL_PROJECT_PRODUCTION_URL = "starday-ashy.vercel.app";
    expect(resolveSiteUrl()).toBe("https://starday-ashy.vercel.app");
  });

  it("ignores invalid values and keeps the next candidate", () => {
    process.env.NEXT_PUBLIC_SITE_URL = "not a url";
    process.env.VERCEL_PROJECT_PRODUCTION_URL = "starday-ashy.vercel.app";
    expect(resolveSiteUrl()).toBe("https://starday-ashy.vercel.app");
  });
});

describe("siteHost", () => {
  it("returns the host of the resolved site URL", () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://example.test";
    expect(siteHost()).toBe("example.test");
  });

  it("keeps a non-default port", () => {
    process.env.NEXT_PUBLIC_SITE_URL = "http://localhost:3111/";
    expect(siteHost()).toBe("localhost:3111");
  });

  it("works with a Vercel-style host without scheme", () => {
    process.env.VERCEL_PROJECT_PRODUCTION_URL = "starday-ashy.vercel.app";
    expect(siteHost()).toBe("starday-ashy.vercel.app");
  });
});
