import { NextRequest, NextResponse } from "next/server";
import {
  AstroSuccess,
  AstroErrorBody,
  DATE_REGEX,
  validateDate,
  daysDiff,
  isRawOrFits,
  sanitiseCopyright,
  type ErrorCode,
} from "@/lib/astro-types";
import { todayUtcString } from "@/lib/date";
import { fetchWithTimeout } from "@/lib/fetch";
import type { ApodResponse, NasaImagesSearchResponse } from "@/lib/nasa-types";

// Cache-Control via headers is authoritative. Removed `export const revalidate = 0`
// which conflicted with in-memory cache (s-maxage 86400 for past dates vs forced
// dynamic). Keep force-dynamic so Vercel doesn't statically cache today/error.
export const dynamic = "force-dynamic";

// ---------- constants ----------

// --- Rate limit constants ---
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 60 second sliding window
const RATE_LIMIT_MAX = 10; // requests per window per IP

// TODO KV: replace in-memory maps with Vercel KV / Upstash Redis for
// multi-instance consistency. In-memory LRU below is fallback for single
// instance / dev and survives only within one serverless isolate. Keeping
// maxSize 500 + sweep interval to bound memory.
const MAX_MAP_SIZE = 500;
const SWEEP_INTERVAL_MS = 5 * 60 * 1000;

// Per-request timeouts — global fallback is 5s, leaving headroom under the
// 10s Vercel function budget on top of the 4s APOD fetch.
const APOD_TIMEOUT_MS = 4000;
const FALLBACK_TIMEOUT_MS = 4500;
const FALLBACK_GLOBAL_TIMEOUT_MS = 5000;

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h

// ---------- shared types ----------

type RateLimitEntry = { count: number; resetAt: number };
type CacheEntry = { value: AstroSuccess; expiresAt: number };
type RateLimitInfo = { limit: number; remaining: number; resetAt: number };
type RequestCtx = { ip: string; startMs: number };

interface LogFields {
  ip: string;
  date: string | null;
  cacheHit: boolean;
  upstreamStatus: number | null;
  fallbackUsed: boolean;
  latencyMs: number;
  status: number;
  code?: ErrorCode;
  retryAfter?: number;
}

const rateLimitMap = new Map<string, RateLimitEntry>();
const cacheMap = new Map<string, CacheEntry>();

// ---------- map helpers ----------

function evictIfNeeded<K, V>(map: Map<K, V>): void {
  // Trim down TO the cap (not a single entry) — one oversized burst would
  // otherwise leave the map permanently above MAX_MAP_SIZE.
  while (map.size > MAX_MAP_SIZE) {
    const first = map.keys().next().value as K | undefined;
    if (first === undefined) break;
    map.delete(first);
  }
}

// Periodic sweep of expired entries to bound memory even without eviction
if (typeof setInterval !== "undefined") {
  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [k, v] of cacheMap) {
      if (v.expiresAt <= now) cacheMap.delete(k);
    }
    for (const [k, v] of rateLimitMap) {
      if (v.resetAt <= now) rateLimitMap.delete(k);
    }
    // Hard cap if still oversized (e.g. clock skew): trim oldest
    while (cacheMap.size > MAX_MAP_SIZE) {
      const first = cacheMap.keys().next().value as string | undefined;
      if (first === undefined) break;
      cacheMap.delete(first);
    }
    while (rateLimitMap.size > MAX_MAP_SIZE) {
      const first = rateLimitMap.keys().next().value as string | undefined;
      if (first === undefined) break;
      rateLimitMap.delete(first);
    }
  }, SWEEP_INTERVAL_MS);
  // Don't keep Node alive just for sweep
  const anySweep = sweep as unknown as { unref?: () => void };
  if (typeof anySweep.unref === "function") anySweep.unref();
}

// ---------- client IP ----------

/**
 * Client IP for rate limiting.
 * Vercel overwrites `x-forwarded-for` with the real client IP and does not
 * forward external values (anti-spoofing), so the FIRST entry is trusted on
 * Vercel (https://vercel.com/docs/headers/request-headers). `x-real-ip` is
 * documented as identical and is the fallback. There is no
 * `x-vercel-forwarded-for` request header — do not read it.
 * Caveat: behind a custom proxy on top of Vercel these headers reflect the
 * proxy, not the end client (Enterprise trusted-proxy aside).
 */
function getClientIp(request: NextRequest): string {
  const pickFirst = (value: string | null): string | null => {
    if (!value) return null;
    const first = value
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)[0];
    return first ?? null;
  };
  return (
    pickFirst(request.headers.get("x-forwarded-for")) ??
    pickFirst(request.headers.get("x-real-ip")) ??
    (request as unknown as { ip?: string }).ip ??
    "unknown"
  );
}

// ---------- rate limit ----------

function checkRateLimit(ip: string): { allowed: boolean } & RateLimitInfo {
  const now = Date.now();
  const existing = rateLimitMap.get(ip);

  if (!existing || existing.resetAt <= now) {
    const resetAt = now + RATE_LIMIT_WINDOW_MS;
    rateLimitMap.set(ip, { count: 1, resetAt });
    evictIfNeeded(rateLimitMap);
    return { allowed: true, limit: RATE_LIMIT_MAX, remaining: RATE_LIMIT_MAX - 1, resetAt };
  }

  if (existing.count >= RATE_LIMIT_MAX) {
    return {
      allowed: false,
      limit: RATE_LIMIT_MAX,
      remaining: 0,
      resetAt: existing.resetAt,
    };
  }

  existing.count += 1;
  return {
    allowed: true,
    limit: RATE_LIMIT_MAX,
    remaining: RATE_LIMIT_MAX - existing.count,
    resetAt: existing.resetAt,
  };
}

function applyRateLimitHeaders(res: NextResponse, info: RateLimitInfo): NextResponse {
  res.headers.set("X-RateLimit-Limit", String(info.limit));
  res.headers.set("X-RateLimit-Remaining", String(info.remaining));
  const resetInSec = Math.max(0, Math.ceil((info.resetAt - Date.now()) / 1000));
  res.headers.set("X-RateLimit-Reset", String(resetInSec));
  return res;
}

// ---------- cache ----------

function getCached(date: string): AstroSuccess | null {
  if (date >= todayUtcString()) return null;
  const entry = cacheMap.get(date);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    cacheMap.delete(date);
    return null;
  }
  // Refresh LRU order on hit
  cacheMap.delete(date);
  cacheMap.set(date, entry);
  return entry.value;
}

function setCached(date: string, value: AstroSuccess): void {
  if (date >= todayUtcString()) return;
  cacheMap.set(date, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  evictIfNeeded(cacheMap);
}

// ---------- logging ----------

/**
 * Structured JSON logger. NEVER log the API key: any field literally named
 * `api_key` / `apiKey` is overwritten with `[REDACTED]`, and any string
 * containing `api_key=...` in a query string is masked.
 */
function logStructured(fields: LogFields): void {
  const safe: Record<string, unknown> = { ...fields };
  if ("api_key" in safe) safe.api_key = "[REDACTED]";
  if ("apiKey" in safe) safe.apiKey = "[REDACTED]";
  for (const k of Object.keys(safe)) {
    if (typeof safe[k] === "string" && (safe[k] as string).includes("api_key")) {
      safe[k] = (safe[k] as string).replace(/api_key=[^&\s]+/gi, "api_key=[REDACTED]");
    }
  }
  console.log(JSON.stringify(safe));
}

// ---------- response builders ----------

function parseRetryAfter(res: Response): number | undefined {
  const h = res.headers.get("Retry-After");
  if (!h) return undefined;
  const secs = parseInt(h, 10);
  if (!isNaN(secs)) return secs;
  // Date form
  const date = Date.parse(h);
  if (!isNaN(date)) {
    return Math.max(0, Math.ceil((date - Date.now()) / 1000));
  }
  return undefined;
}

function getApiKey(): string | null {
  const key = process.env.NASA_API_KEY || (process.env.NODE_ENV === "development" ? "DEMO_KEY" : null);
  return key ?? null;
}

function cacheControlForSuccess(requestedDate: string): string {
  // Past dates are immutable -> long s-maxage, today is mutable -> no-store
  if (requestedDate < todayUtcString()) {
    return "public, s-maxage=86400, stale-while-revalidate=3600";
  }
  return "no-store";
}

function errorJson(
  message: string,
  code: ErrorCode,
  status: number,
  rateLimit: RateLimitInfo,
  retryAfterSec?: number
): NextResponse<AstroErrorBody> {
  const res = NextResponse.json({ error: message, code }, { status });
  applyRateLimitHeaders(res, rateLimit);
  res.headers.set("Cache-Control", "no-store");
  if (status === 429) {
    const sec = retryAfterSec ?? Math.max(0, Math.ceil((rateLimit.resetAt - Date.now()) / 1000));
    res.headers.set("Retry-After", String(sec));
  }
  return res as NextResponse<AstroErrorBody>;
}

function successJson(
  body: AstroSuccess,
  rateLimit: RateLimitInfo
): NextResponse<AstroSuccess> {
  const res = NextResponse.json(body, { status: 200 });
  applyRateLimitHeaders(res, rateLimit);
  res.headers.set("Cache-Control", cacheControlForSuccess(body.requestedDate));
  return res as NextResponse<AstroSuccess>;
}

/**
 * Build, log, and return a success response. `upstreamStatus` is the status
 * code we got from NASA APOD (or `null` if we never reached it — cache hit,
 * config error, fetch threw before getting a response, etc).
 *
 * Cache write is skipped when `cacheHit` is true: the value came from the
 * in-memory cache, so re-inserting it would only bump the TTL.
 */
function respondSuccess(
  ctx: RequestCtx,
  rateLimit: RateLimitInfo,
  body: AstroSuccess,
  opts: { cacheHit: boolean; upstreamStatus: number | null }
): NextResponse<AstroSuccess> {
  const res = successJson(body, rateLimit);
  if (!opts.cacheHit) setCached(body.requestedDate, body);
  logStructured({
    ip: ctx.ip,
    date: body.requestedDate,
    cacheHit: opts.cacheHit,
    upstreamStatus: opts.upstreamStatus,
    fallbackUsed: body.isFallback,
    latencyMs: Date.now() - ctx.startMs,
    status: 200,
  });
  return res;
}

/**
 * Build, log, and return an error response.
 */
function respondError(
  ctx: RequestCtx,
  rateLimit: RateLimitInfo,
  message: string,
  code: ErrorCode,
  status: number,
  opts: { date: string | null; upstreamStatus: number | null; retryAfter?: number }
): NextResponse<AstroErrorBody> {
  const res = errorJson(message, code, status, rateLimit, opts.retryAfter);
  logStructured({
    ip: ctx.ip,
    date: opts.date,
    cacheHit: false,
    upstreamStatus: opts.upstreamStatus,
    fallbackUsed: false,
    latencyMs: Date.now() - ctx.startMs,
    status,
    code,
    retryAfter: opts.retryAfter,
  });
  return res;
}

/** Build the 429 response triggered by the in-memory rate limiter (pre-handler). */
function rateLimitedResponse(
  ctx: { ip: string; startMs: number },
  rateLimit: RateLimitInfo,
  dateForLog: string | null
): NextResponse {
  const res = NextResponse.json(
    { error: "Too many requests, try again in a minute.", code: "RATE_LIMIT" as ErrorCode },
    { status: 429 }
  );
  applyRateLimitHeaders(res, rateLimit);
  res.headers.set("Cache-Control", "no-store");
  const retryAfter = Math.max(0, Math.ceil((rateLimit.resetAt - Date.now()) / 1000));
  res.headers.set("Retry-After", String(retryAfter));
  logStructured({
    ip: ctx.ip,
    date: dateForLog,
    cacheHit: false,
    upstreamStatus: null,
    fallbackUsed: false,
    latencyMs: Date.now() - ctx.startMs,
    status: 429,
    code: "RATE_LIMIT",
  });
  return res;
}

// ---------- fallback logic ----------

async function fetchFallback(requestedDate: string): Promise<AstroSuccess | null> {
  const year = requestedDate.slice(0, 4);

  const urls = [
    `https://images-api.nasa.gov/search?q=Hubble%20Space%20Telescope&media_type=image&year_start=${year}&year_end=${year}`,
    `https://images-api.nasa.gov/search?q=James%20Webb%20Space%20Telescope&media_type=image&year_start=${year}&year_end=${year}`,
  ];

  // Global timeout 5s for the whole fallback. Combined with the 4s APOD
  // budget below, worst-case wall time stays under the 10s Vercel limit.
  const globalController = new AbortController();
  const globalTimer = setTimeout(() => globalController.abort(), FALLBACK_GLOBAL_TIMEOUT_MS);

  let results: PromiseSettledResult<Response>[];
  try {
    results = await Promise.allSettled(
      urls.map((url) =>
        fetchWithTimeout(url, { cache: "no-store", signal: globalController.signal }, FALLBACK_TIMEOUT_MS)
      )
    );
  } catch {
    clearTimeout(globalTimer);
    return null;
  }
  clearTimeout(globalTimer);

  let allItems: NasaImagesSearchResponse["collection"]["items"] = [];
  for (const r of results) {
    if (r.status !== "fulfilled") continue;
    const res = r.value;
    // 429 from a fallback source means NASA told us to back off — skip it
    // rather than retrying inside the global 5s budget.
    if (res.status === 429 || !res.ok) continue;
    try {
      const data = (await res.json()) as NasaImagesSearchResponse;
      if (data.collection?.items?.length) allItems = allItems.concat(data.collection.items);
    } catch {
      continue;
    }
  }

  if (allItems.length === 0) return null;

  const items = allItems;

  let best: (typeof items)[number] | null = null;
  let bestDiff = Infinity;

  for (let i = 0; i < items.length; i++) {
    const dc = items[i].data?.[0]?.date_created;
    if (!dc) continue;
    const isoDate = dc.slice(0, 10);
    if (!DATE_REGEX.test(isoDate)) continue;
    const diff = daysDiff(isoDate, requestedDate);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = items[i];
    }
  }

  if (!best) return null;

  const bestData = best.data?.[0];
  const link = best.links?.[0]?.href;
  if (!link) return null;

  const imageUrl = link.includes("~orig") ? link.replace("~orig", "~large") : link;

  if (!imageUrl.startsWith("https://")) return null;
  // Also filter raw/FITS on fallback (same guard as APOD)
  if (isRawOrFits(imageUrl)) return null;

  const title = bestData?.title ?? "Hubble / JWST — NASA Image Library";
  const rawDesc = bestData?.description ?? title;
  const caption = rawDesc.slice(0, 300);

  const rawCreated: string = bestData?.date_created ?? requestedDate;
  const actualDate = DATE_REGEX.test(rawCreated.slice(0, 10)) ? rawCreated.slice(0, 10) : requestedDate;

  const offsetNote =
    actualDate !== requestedDate ? ` (closest available image: ${actualDate}, requested: ${requestedDate})` : "";

  return {
    imageUrl,
    title,
    caption: caption + offsetNote,
    source: "NASA Image Library (Hubble/JWST fallback)",
    creditedTo: sanitiseCopyright(bestData?.photographer) || "NASA/ESA/STScI",
    actualDate,
    isFallback: true,
    requestedDate,
  };
}

// ---------- core handler ----------

async function handleAstro(
  requestedDate: string,
  rateLimit: RateLimitInfo,
  ctx: RequestCtx
): Promise<NextResponse<AstroSuccess | AstroErrorBody>> {
  const v = validateDate(requestedDate);
  if (!v.valid) {
    return respondError(ctx, rateLimit, v.error, v.code, 400, {
      date: requestedDate,
      upstreamStatus: null,
    });
  }

  const cached = getCached(requestedDate);
  if (cached) {
    return respondSuccess(ctx, rateLimit, cached, {
      cacheHit: true,
      upstreamStatus: null,
    });
  }

  const key = getApiKey();
  if (!key) {
    return respondError(ctx, rateLimit, "Server misconfiguration. Contact the administrator.", "CONFIG_ERROR", 500, {
      date: requestedDate,
      upstreamStatus: null,
    });
  }

  const apodUrl = `https://api.nasa.gov/planetary/apod?date=${requestedDate}&api_key=${key}&thumbs=false`;

  let apodRes: Response;
  let upstreamStatus: number | undefined;
  try {
    apodRes = await fetchWithTimeout(apodUrl, { cache: "no-store" }, APOD_TIMEOUT_MS);
    upstreamStatus = apodRes.status;
  } catch {
    const fb = await fetchFallback(requestedDate);
    if (fb) return respondSuccess(ctx, rateLimit, fb, { cacheHit: false, upstreamStatus: null });
    return respondError(ctx, rateLimit, "NASA service temporarily unavailable. Try again later.", "UPSTREAM_ERROR", 502, {
      date: requestedDate,
      upstreamStatus: null,
    });
  }

  if (apodRes.status === 429 || apodRes.status === 403) {
    const retryAfter = parseRetryAfter(apodRes);
    const fb = await fetchFallback(requestedDate);
    if (fb) return respondSuccess(ctx, rateLimit, fb, { cacheHit: false, upstreamStatus: upstreamStatus ?? null });
    return respondError(ctx, rateLimit, "NASA rate limit reached. Try again in a few minutes.", "RATE_LIMIT", 429, {
      date: requestedDate,
      upstreamStatus: upstreamStatus ?? null,
      retryAfter,
    });
  }

  if (apodRes.status === 400) {
    // Our own validateDate already guarantees a well-formed, in-range date,
    // so APOD 400 means "outside APOD coverage" (e.g. pre-1995-06-16) —
    // not a malformed request. Try the Image Library fallback first.
    const fb = await fetchFallback(requestedDate);
    if (fb) return respondSuccess(ctx, rateLimit, fb, { cacheHit: false, upstreamStatus: upstreamStatus ?? null });
    let body: ApodResponse | null = null;
    try {
      body = (await apodRes.json()) as ApodResponse;
    } catch {
      // ignore
    }
    if (body?.msg || body?.code === 400) {
      return respondError(ctx, rateLimit, body.msg ?? "Invalid date for APOD.", "INVALID_DATE", 400, {
        date: requestedDate,
        upstreamStatus: upstreamStatus ?? null,
      });
    }
    return respondError(ctx, rateLimit, "Invalid request.", "INVALID_DATE", 400, {
      date: requestedDate,
      upstreamStatus: upstreamStatus ?? null,
    });
  }

  if (!apodRes.ok) {
    const fb = await fetchFallback(requestedDate);
    if (fb) return respondSuccess(ctx, rateLimit, fb, { cacheHit: false, upstreamStatus: upstreamStatus ?? null });
    return respondError(ctx, rateLimit, "Error fetching the NASA image.", "UPSTREAM_ERROR", 502, {
      date: requestedDate,
      upstreamStatus: upstreamStatus ?? null,
    });
  }

  let apod: ApodResponse;
  try {
    apod = (await apodRes.json()) as ApodResponse;
  } catch {
    const fb = await fetchFallback(requestedDate);
    if (fb) return respondSuccess(ctx, rateLimit, fb, { cacheHit: false, upstreamStatus: upstreamStatus ?? null });
    return respondError(ctx, rateLimit, "Invalid NASA response.", "UPSTREAM_ERROR", 502, {
      date: requestedDate,
      upstreamStatus: upstreamStatus ?? null,
    });
  }

  if (apod.media_type === "image" && (apod.hdurl || apod.url)) {
    const imageUrl = apod.hdurl || apod.url!;
    if (!isRawOrFits(imageUrl)) {
      const result: AstroSuccess = {
        imageUrl,
        title: apod.title,
        caption: (apod.explanation ?? "").slice(0, 300),
        source: "NASA APOD",
        creditedTo: sanitiseCopyright(apod.copyright),
        actualDate: apod.date,
        isFallback: false,
        requestedDate,
      };
      return respondSuccess(ctx, rateLimit, result, { cacheHit: false, upstreamStatus: upstreamStatus ?? null });
    }
    // raw/FITS URL: fall through to the fallback path below
  }

  const fb = await fetchFallback(requestedDate);
  if (fb) return respondSuccess(ctx, rateLimit, fb, { cacheHit: false, upstreamStatus: upstreamStatus ?? null });

  return respondError(ctx, rateLimit, "No image found for this date.", "NOT_FOUND", 404, {
    date: requestedDate,
    upstreamStatus: upstreamStatus ?? null,
  });
}

// ---------- exports GET / POST ----------

export async function GET(request: NextRequest): Promise<NextResponse> {
  const startMs = Date.now();
  const ip = getClientIp(request);
  const rateLimit = checkRateLimit(ip);
  if (!rateLimit.allowed) {
    return rateLimitedResponse({ ip, startMs }, rateLimit, request.nextUrl.searchParams.get("date"));
  }
  const ctx: RequestCtx = { ip, startMs };
  const date = request.nextUrl.searchParams.get("date") ?? undefined;
  if (!date) {
    return respondError(ctx, rateLimit, "Missing 'date' parameter. Use ?date=YYYY-MM-DD.", "INVALID_DATE", 400, {
      date: null,
      upstreamStatus: null,
    });
  }
  return handleAstro(date, rateLimit, ctx);
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const startMs = Date.now();
  const ip = getClientIp(request);
  const rateLimit = checkRateLimit(ip);
  if (!rateLimit.allowed) {
    return rateLimitedResponse({ ip, startMs }, rateLimit, null);
  }
  const ctx: RequestCtx = { ip, startMs };

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    const qp = request.nextUrl.searchParams.get("date");
    if (qp) return handleAstro(qp, rateLimit, ctx);
    return respondError(ctx, rateLimit, "Invalid JSON body. Send { date: 'YYYY-MM-DD' }.", "INVALID_DATE", 400, {
      date: null,
      upstreamStatus: null,
    });
  }

  const date =
    (body as Record<string, unknown>)?.["date"] ??
    request.nextUrl.searchParams.get("date") ??
    undefined;

  if (typeof date !== "string" || !date) {
    return respondError(ctx, rateLimit, "Missing 'date' field. Send { date: 'YYYY-MM-DD' }.", "INVALID_DATE", 400, {
      date: null,
      upstreamStatus: null,
    });
  }

  return handleAstro(date, rateLimit, ctx);
}
