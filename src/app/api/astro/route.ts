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

// Cache-Control via headers is authoritative. Removed `export const revalidate = 0`
// which conflicted with in-memory cache (s-maxage 86400 for past dates vs forced
// dynamic). Keep force-dynamic so Vercel doesn't statically cache today/error.
export const dynamic = "force-dynamic";

// NASA APOD raw shape
interface ApodResponse {
  date: string;
  explanation: string;
  hdurl?: string;
  url?: string;
  media_type: string;
  title: string;
  copyright?: string;
  code?: number;
  msg?: string;
}

// NASA Image Library search shape (partial)
interface NasaImagesSearchResponse {
  collection: {
    items: Array<{
      data: Array<{
        title: string;
        description?: string;
        date_created: string;
        photographer?: string;
        nasa_id?: string;
      }>;
      links?: Array<{ href: string; rel?: string; render?: string }>;
    }>;
    metadata?: { total_hits: number };
  };
}

// ---------- helpers ----------

// --- Rate limit constants ---
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 60 second sliding window
const RATE_LIMIT_MAX = 10; // requests per window per IP

// TODO KV: replace in-memory maps with Vercel KV / Upstash Redis for
// multi-instance consistency. In-memory LRU below is fallback for single
// instance / dev and survives only within one serverless isolate. Keeping
// maxSize 500 + sweep interval to bound memory.
const MAX_MAP_SIZE = 500;
const SWEEP_INTERVAL_MS = 5 * 60 * 1000;

type RateLimitEntry = { count: number; resetAt: number };
const rateLimitMap = new Map<string, RateLimitEntry>();

type CacheEntry = { value: AstroSuccess; expiresAt: number };
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h
const cacheMap = new Map<string, CacheEntry>();

function evictIfNeeded<K, V>(map: Map<K, V>): void {
  if (map.size > MAX_MAP_SIZE) {
    const first = map.keys().next().value as K | undefined;
    if (first !== undefined) map.delete(first);
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

/**
 * Trusted proxy: on Vercel the edge terminates TLS and sets
 * `x-vercel-forwarded-for` as the trusted client chain. We take the
 * last entry via pop() (the real client as seen by Vercel). Fallback
 * is NextRequest.ip (populated by Vercel runtime) then "unknown".
 * Do NOT trust generic x-forwarded-for first-entry without Vercel header
 * because it is client-spoofable.
 */
function getClientIp(request: NextRequest): string {
  const xvff = request.headers.get("x-vercel-forwarded-for");
  if (xvff) {
    const parts = xvff
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const last = parts.pop();
    if (last) return last;
  }
  const ip = (request as unknown as { ip?: string }).ip;
  if (ip) return ip;
  return "unknown";
}

function checkRateLimit(ip: string): {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: number;
} {
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

function applyRateLimitHeaders(
  res: NextResponse,
  info: { limit: number; remaining: number; resetAt: number }
): NextResponse {
  res.headers.set("X-RateLimit-Limit", String(info.limit));
  res.headers.set("X-RateLimit-Remaining", String(info.remaining));
  const resetInSec = Math.max(0, Math.ceil((info.resetAt - Date.now()) / 1000));
  res.headers.set("X-RateLimit-Reset", String(resetInSec));
  return res;
}

function todayUtcString(): string {
  return new Date().toISOString().slice(0, 10);
}

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

// --- Fetch with AbortController timeout ---
async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = 8000
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const upstreamSignal = init.signal;
    if (upstreamSignal) {
      if (upstreamSignal.aborted) controller.abort();
      else upstreamSignal.addEventListener("abort", () => controller.abort(), { once: true });
    }
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
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
  rateLimit: { limit: number; remaining: number; resetAt: number },
  retryAfterSec?: number
): NextResponse<AstroErrorBody> {
  const res = NextResponse.json({ error: message, code }, { status });
  applyRateLimitHeaders(res, rateLimit);
  res.headers.set("Cache-Control", "no-store");
  if (status === 429) {
    const sec =
      retryAfterSec ?? Math.max(0, Math.ceil((rateLimit.resetAt - Date.now()) / 1000)) ?? 60;
    res.headers.set("Retry-After", String(sec));
  }
  return res as NextResponse<AstroErrorBody>;
}

function successJson(
  body: AstroSuccess,
  rateLimit: { limit: number; remaining: number; resetAt: number }
): NextResponse<AstroSuccess> {
  const res = NextResponse.json(body, { status: 200 });
  applyRateLimitHeaders(res, rateLimit);
  res.headers.set("Cache-Control", cacheControlForSuccess(body.requestedDate));
  return res as NextResponse<AstroSuccess>;
}

// Structured JSON logger - NEVER log api_key
function logStructured(fields: Record<string, unknown>): void {
  // Redact any api_key accidentally passed
  const safe: Record<string, unknown> = { ...fields };
  if ("api_key" in safe) safe.api_key = "[REDACTED]";
  if ("apiKey" in safe) safe.apiKey = "[REDACTED]";
  // Ensure url fields don't contain api_key
  for (const k of Object.keys(safe)) {
    if (typeof safe[k] === "string" && (safe[k] as string).includes("api_key")) {
      safe[k] = (safe[k] as string).replace(/api_key=[^&\s]+/gi, "api_key=[REDACTED]");
    }
  }
  console.log(JSON.stringify(safe));
}

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

// ---------- fallback logic ----------

async function fetchFallback(requestedDate: string): Promise<AstroSuccess | null> {
  const year = requestedDate.slice(0, 4);

  const urls = [
    `https://images-api.nasa.gov/search?q=Hubble%20Space%20Telescope&media_type=image&year_start=${year}&year_end=${year}`,
    `https://images-api.nasa.gov/search?q=James%20Webb%20Space%20Telescope&media_type=image&year_start=${year}&year_end=${year}`,
  ];

  // Global timeout 9s for the whole fallback (vs sequential 8s*2=16s > Vercel 10s)
  const globalController = new AbortController();
  const globalTimer = setTimeout(() => globalController.abort(), 9000);

  let results: PromiseSettledResult<Response>[];
  try {
    results = await Promise.allSettled(
      urls.map((url) =>
        fetchWithTimeout(url, { cache: "no-store", signal: globalController.signal }, 8000)
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
    // Respect Retry-After on 429 - skip this source
    if (res.status === 429) {
      const ra = parseRetryAfter(res);
      // log respect (no retry within global window)
      void ra;
      continue;
    }
    if (!res.ok) continue;
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
    actualDate !== requestedDate ? ` (immagine più vicina disponibile: ${actualDate}, richiesta: ${requestedDate})` : "";

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
  rateLimit: { limit: number; remaining: number; resetAt: number },
  ctx: { ip: string; startMs: number; cacheHit: boolean; fallbackUsed: boolean; upstreamStatus?: number }
): Promise<NextResponse<AstroSuccess | AstroErrorBody>> {
  const v = validateDate(requestedDate);
  if (!v.valid) {
    const res = errorJson(v.error, v.code, 400, rateLimit);
    logStructured({
      ip: ctx.ip,
      date: requestedDate,
      cacheHit: false,
      upstreamStatus: null,
      fallbackUsed: false,
      latencyMs: Date.now() - ctx.startMs,
      status: 400,
      code: v.code,
    });
    return res;
  }

  const cached = getCached(requestedDate);
  if (cached) {
    const res = successJson(cached, rateLimit);
    logStructured({
      ip: ctx.ip,
      date: requestedDate,
      cacheHit: true,
      upstreamStatus: null,
      fallbackUsed: false,
      latencyMs: Date.now() - ctx.startMs,
      status: 200,
    });
    return res;
  }

  const key = getApiKey();
  if (!key) {
    const res = errorJson("Configurazione server mancante. Contatta l'amministratore.", "CONFIG_ERROR", 500, rateLimit);
    logStructured({
      ip: ctx.ip,
      date: requestedDate,
      cacheHit: false,
      upstreamStatus: null,
      fallbackUsed: false,
      latencyMs: Date.now() - ctx.startMs,
      status: 500,
      code: "CONFIG_ERROR",
    });
    return res;
  }

  const apodUrl = `https://api.nasa.gov/planetary/apod?date=${requestedDate}&api_key=${key}&thumbs=false`;

  let apodRes: Response;
  let upstreamStatus: number | undefined;
  try {
    apodRes = await fetchWithTimeout(apodUrl, { cache: "no-store" }, 8000);
    upstreamStatus = apodRes.status;
  } catch {
    const fb = await fetchFallback(requestedDate);
    if (fb) {
      setCached(requestedDate, fb);
      const res = successJson(fb, rateLimit);
      logStructured({
        ip: ctx.ip,
        date: requestedDate,
        cacheHit: false,
        upstreamStatus: null,
        fallbackUsed: true,
        latencyMs: Date.now() - ctx.startMs,
        status: 200,
      });
      return res;
    }
    const res = errorJson("Servizio NASA temporaneamente non disponibile. Riprova più tardi.", "UPSTREAM_ERROR", 502, rateLimit);
    logStructured({
      ip: ctx.ip,
      date: requestedDate,
      cacheHit: false,
      upstreamStatus: null,
      fallbackUsed: false,
      latencyMs: Date.now() - ctx.startMs,
      status: 502,
      code: "UPSTREAM_ERROR",
    });
    return res;
  }

  if (apodRes.status === 429 || apodRes.status === 403) {
    const retryAfter = parseRetryAfter(apodRes);
    const fb = await fetchFallback(requestedDate);
    if (fb) {
      setCached(requestedDate, fb);
      const res = successJson(fb, rateLimit);
      logStructured({
        ip: ctx.ip,
        date: requestedDate,
        cacheHit: false,
        upstreamStatus,
        fallbackUsed: true,
        latencyMs: Date.now() - ctx.startMs,
        status: 200,
      });
      return res;
    }
    const res = errorJson("Limite richieste NASA raggiunto. Riprova tra qualche minuto.", "RATE_LIMIT", 429, rateLimit, retryAfter);
    logStructured({
      ip: ctx.ip,
      date: requestedDate,
      cacheHit: false,
      upstreamStatus,
      fallbackUsed: false,
      latencyMs: Date.now() - ctx.startMs,
      status: 429,
      code: "RATE_LIMIT",
      retryAfter,
    });
    return res;
  }

  if (apodRes.status === 400) {
    let body: ApodResponse | null = null;
    try {
      body = (await apodRes.json()) as ApodResponse;
    } catch {
      // ignore
    }
    if (body?.msg || body?.code === 400) {
      const res = errorJson(body.msg ?? "Data non valida per APOD.", "INVALID_DATE", 400, rateLimit);
      logStructured({
        ip: ctx.ip,
        date: requestedDate,
        cacheHit: false,
        upstreamStatus,
        fallbackUsed: false,
        latencyMs: Date.now() - ctx.startMs,
        status: 400,
        code: "INVALID_DATE",
      });
      return res;
    }
    const res = errorJson("Richiesta non valida.", "INVALID_DATE", 400, rateLimit);
    logStructured({
      ip: ctx.ip,
      date: requestedDate,
      cacheHit: false,
      upstreamStatus,
      fallbackUsed: false,
      latencyMs: Date.now() - ctx.startMs,
      status: 400,
      code: "INVALID_DATE",
    });
    return res;
  }

  if (!apodRes.ok) {
    const fb = await fetchFallback(requestedDate);
    if (fb) {
      setCached(requestedDate, fb);
      const res = successJson(fb, rateLimit);
      logStructured({
        ip: ctx.ip,
        date: requestedDate,
        cacheHit: false,
        upstreamStatus,
        fallbackUsed: true,
        latencyMs: Date.now() - ctx.startMs,
        status: 200,
      });
      return res;
    }
    const res = errorJson("Errore nel recupero dell'immagine NASA.", "UPSTREAM_ERROR", 502, rateLimit);
    logStructured({
      ip: ctx.ip,
      date: requestedDate,
      cacheHit: false,
      upstreamStatus,
      fallbackUsed: false,
      latencyMs: Date.now() - ctx.startMs,
      status: 502,
      code: "UPSTREAM_ERROR",
    });
    return res;
  }

  let apod: ApodResponse;
  try {
    apod = (await apodRes.json()) as ApodResponse;
  } catch {
    const fb = await fetchFallback(requestedDate);
    if (fb) {
      setCached(requestedDate, fb);
      const res = successJson(fb, rateLimit);
      logStructured({
        ip: ctx.ip,
        date: requestedDate,
        cacheHit: false,
        upstreamStatus,
        fallbackUsed: true,
        latencyMs: Date.now() - ctx.startMs,
        status: 200,
      });
      return res;
    }
    const res = errorJson("Risposta NASA non valida.", "UPSTREAM_ERROR", 502, rateLimit);
    logStructured({
      ip: ctx.ip,
      date: requestedDate,
      cacheHit: false,
      upstreamStatus,
      fallbackUsed: false,
      latencyMs: Date.now() - ctx.startMs,
      status: 502,
      code: "UPSTREAM_ERROR",
    });
    return res;
  }

  if (apod.media_type === "image" && (apod.hdurl || apod.url)) {
    const imageUrl = apod.hdurl || apod.url!;
    if (isRawOrFits(imageUrl)) {
      // tratta come non-image -> fallback
    } else {
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
      setCached(requestedDate, result);
      const res = successJson(result, rateLimit);
      logStructured({
        ip: ctx.ip,
        date: requestedDate,
        cacheHit: false,
        upstreamStatus,
        fallbackUsed: false,
        latencyMs: Date.now() - ctx.startMs,
        status: 200,
      });
      return res;
    }
  }

  const fb = await fetchFallback(requestedDate);
  if (fb) {
    setCached(requestedDate, fb);
    const res = successJson(fb, rateLimit);
    logStructured({
      ip: ctx.ip,
      date: requestedDate,
      cacheHit: false,
      upstreamStatus,
      fallbackUsed: true,
      latencyMs: Date.now() - ctx.startMs,
      status: 200,
    });
    return res;
  }

  const res = errorJson("Nessuna immagine trovata per questa data.", "NOT_FOUND", 404, rateLimit);
  logStructured({
    ip: ctx.ip,
    date: requestedDate,
    cacheHit: false,
    upstreamStatus,
    fallbackUsed: false,
    latencyMs: Date.now() - ctx.startMs,
    status: 404,
    code: "NOT_FOUND",
  });
  return res;
}

// ---------- exports GET / POST ----------

export async function GET(request: NextRequest): Promise<NextResponse> {
  const startMs = Date.now();
  const ip = getClientIp(request);
  const rateLimit = checkRateLimit(ip);

  if (!rateLimit.allowed) {
    const res = NextResponse.json(
      { error: "Troppe richieste, riprova tra un minuto.", code: "RATE_LIMIT" },
      { status: 429 }
    );
    applyRateLimitHeaders(res, rateLimit);
    res.headers.set("Cache-Control", "no-store");
    const retryAfter = Math.max(0, Math.ceil((rateLimit.resetAt - Date.now()) / 1000));
    res.headers.set("Retry-After", String(retryAfter));
    logStructured({ ip, date: request.nextUrl.searchParams.get("date") ?? null, cacheHit: false, upstreamStatus: null, fallbackUsed: false, latencyMs: Date.now() - startMs, status: 429, code: "RATE_LIMIT" });
    return res;
  }

  const date = request.nextUrl.searchParams.get("date") ?? undefined;
  if (!date) {
    const res = errorJson("Parametro 'date' mancante. Usa ?date=YYYY-MM-DD.", "INVALID_DATE", 400, rateLimit);
    logStructured({ ip, date: null, cacheHit: false, upstreamStatus: null, fallbackUsed: false, latencyMs: Date.now() - startMs, status: 400, code: "INVALID_DATE" });
    return res;
  }
  return handleAstro(date, rateLimit, { ip, startMs, cacheHit: false, fallbackUsed: false });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const startMs = Date.now();
  const ip = getClientIp(request);
  const rateLimit = checkRateLimit(ip);

  if (!rateLimit.allowed) {
    const res = NextResponse.json(
      { error: "Troppe richieste, riprova tra un minuto.", code: "RATE_LIMIT" },
      { status: 429 }
    );
    applyRateLimitHeaders(res, rateLimit);
    res.headers.set("Cache-Control", "no-store");
    const retryAfter = Math.max(0, Math.ceil((rateLimit.resetAt - Date.now()) / 1000));
    res.headers.set("Retry-After", String(retryAfter));
    logStructured({ ip, date: null, cacheHit: false, upstreamStatus: null, fallbackUsed: false, latencyMs: Date.now() - startMs, status: 429, code: "RATE_LIMIT" });
    return res;
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    const qp = request.nextUrl.searchParams.get("date");
    if (qp) return handleAstro(qp, rateLimit, { ip, startMs, cacheHit: false, fallbackUsed: false });
    const res = errorJson("Body JSON non valido. Invia { date: 'YYYY-MM-DD' }.", "INVALID_DATE", 400, rateLimit);
    logStructured({ ip, date: null, cacheHit: false, upstreamStatus: null, fallbackUsed: false, latencyMs: Date.now() - startMs, status: 400, code: "INVALID_DATE" });
    return res;
  }

  const date =
    (body as Record<string, unknown>)?.["date"] ??
    request.nextUrl.searchParams.get("date") ??
    undefined;

  if (typeof date !== "string" || !date) {
    const res = errorJson("Campo 'date' mancante. Invia { date: 'YYYY-MM-DD' }.", "INVALID_DATE", 400, rateLimit);
    logStructured({ ip, date: null, cacheHit: false, upstreamStatus: null, fallbackUsed: false, latencyMs: Date.now() - startMs, status: 400, code: "INVALID_DATE" });
    return res;
  }

  return handleAstro(date, rateLimit, { ip, startMs, cacheHit: false, fallbackUsed: false });
}
