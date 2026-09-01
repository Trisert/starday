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

export const revalidate = 0;
export const dynamic = "force-dynamic";

// Re-export the public contract types so existing imports from this module
// keep working for any consumer still reading from /api/astro's typed surface.
export type { AstroSuccess, AstroErrorBody, ErrorCode };

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

// In-memory rate limit store. Does NOT survive serverless cold starts —
// acceptable on Vercel free tier per task spec.
type RateLimitEntry = { count: number; resetAt: number };
const rateLimitMap = new Map<string, RateLimitEntry>();

function getClientIp(request: NextRequest): string {
  const xff = request.headers.get("x-forwarded-for");
  if (xff) {
    // Take first IP in the list (client)
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  const xri = request.headers.get("x-real-ip");
  if (xri) return xri.trim();
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
    // New window
    const resetAt = now + RATE_LIMIT_WINDOW_MS;
    rateLimitMap.set(ip, { count: 1, resetAt });
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
  // Reset is seconds-until-reset (standard convention)
  const resetInSec = Math.max(0, Math.ceil((info.resetAt - Date.now()) / 1000));
  res.headers.set("X-RateLimit-Reset", String(resetInSec));
  return res;
}

// --- 24h cache for past APOD dates (in-memory Map) ---
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h
type CacheEntry = { value: AstroSuccess; expiresAt: number };
const cacheMap = new Map<string, CacheEntry>();

function todayUtcString(): string {
  return new Date().toISOString().slice(0, 10);
}

function getCached(date: string): AstroSuccess | null {
  if (date >= todayUtcString()) return null; // only cache past dates
  const entry = cacheMap.get(date);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    cacheMap.delete(date);
    return null;
  }
  return entry.value;
}

function setCached(date: string, value: AstroSuccess): void {
  if (date >= todayUtcString()) return; // only cache past dates
  cacheMap.set(date, { value, expiresAt: Date.now() + CACHE_TTL_MS });
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
    // If caller passed their own signal, fan out aborts
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

// validateDate, daysDiff, DATE_REGEX, isRawOrFits live in @/lib/astro-types

function getApiKey(): string | null {
  const key = process.env.NASA_API_KEY || (process.env.NODE_ENV === "development" ? "DEMO_KEY" : null);
  return key ?? null;
}

function errorJson(
  message: string,
  code: string,
  status: number,
  rateLimit: { limit: number; remaining: number; resetAt: number }
): NextResponse<AstroErrorBody> {
  const res = NextResponse.json({ error: message, code }, { status });
  return applyRateLimitHeaders(res, rateLimit) as NextResponse<AstroErrorBody>;
}

function successJson(
  body: AstroSuccess,
  rateLimit: { limit: number; remaining: number; resetAt: number }
): NextResponse<AstroSuccess> {
  const res = NextResponse.json(body, { status: 200 });
  return applyRateLimitHeaders(res, rateLimit) as NextResponse<AstroSuccess>;
}

// ---------- fallback logic ----------

async function fetchFallback(requestedDate: string): Promise<AstroSuccess | null> {
  const year = requestedDate.slice(0, 4);

  // Fix review: +OR+ query returns 1 hit vs 22 with Hubble alone. Parallel fetch Hubble + JWST then merge.
  const urls = [
    `https://images-api.nasa.gov/search?q=Hubble%20Space%20Telescope&media_type=image&year_start=${year}&year_end=${year}`,
    `https://images-api.nasa.gov/search?q=James%20Webb%20Space%20Telescope&media_type=image&year_start=${year}&year_end=${year}`,
  ];

  let allItems: NasaImagesSearchResponse["collection"]["items"] = [];
  for (const url of urls) {
    try {
      const res = await fetchWithTimeout(url, { cache: "no-store" }, 8000);
      if (!res.ok) continue;
      const data = (await res.json()) as NasaImagesSearchResponse;
      if (data.collection?.items?.length) allItems = allItems.concat(data.collection.items);
    } catch {
      continue;
    }
  }

  if (allItems.length === 0) return null;

  const items = allItems;

  // Scegli item con date_created più vicino a requestedDate — fix bestIdx null init
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

  // Sostituisci ~orig con ~large se presente, altrimenti usa href diretto
  // NASA images links tipicamente: https://images-assets.nasa.gov/image/xxx/xxx~orig.jpg
  const imageUrl = link.includes("~orig") ? link.replace("~orig", "~large") : link;

  // Valida che sia https
  if (!imageUrl.startsWith("https://")) return null;

  const title = bestData?.title ?? "Hubble / JWST — NASA Image Library";
  const rawDesc = bestData?.description ?? title;
  const caption = rawDesc.slice(0, 300);

  // actualDate dal date_created (YYYY-MM-DD)
  const rawCreated: string = bestData?.date_created ?? requestedDate;
  const actualDate = DATE_REGEX.test(rawCreated.slice(0, 10)) ? rawCreated.slice(0, 10) : requestedDate;

  // Segnala scostamento se diverso
  const offsetNote =
    actualDate !== requestedDate ? ` (immagine più vicina disponibile: ${actualDate}, richiesta: ${requestedDate})` : "";

  return {
    imageUrl,
    title,
    caption: caption + offsetNote,
    source: "NASA Image Library (Hubble/JWST fallback)",
    creditedTo: bestData?.photographer || "NASA/ESA/STScI",
    actualDate,
    isFallback: true,
    requestedDate,
  };
}

// ---------- core handler ----------

async function handleAstro(
  requestedDate: string,
  rateLimit: { limit: number; remaining: number; resetAt: number }
): Promise<NextResponse<AstroSuccess | AstroErrorBody>> {
  // 1) valida data
  const v = validateDate(requestedDate);
  if (!v.valid) {
    return errorJson(v.error, v.code, 400, rateLimit);
  }

  // 1b) cache hit per date passate — short-circuit upstream
  const cached = getCached(requestedDate);
  if (cached) {
    return successJson(cached, rateLimit);
  }

  // 2) api key
  const key = getApiKey();
  if (!key) {
    return errorJson("Configurazione server mancante. Contatta l'amministratore.", "CONFIG_ERROR", 500, rateLimit);
  }

  // 3) fetch APOD
  const apodUrl = `https://api.nasa.gov/planetary/apod?date=${requestedDate}&api_key=${key}&thumbs=false`;

  let apodRes: Response;
  try {
    apodRes = await fetchWithTimeout(apodUrl, { cache: "no-store" }, 8000);
  } catch {
    // Errore rete -> tenta fallback
    const fb = await fetchFallback(requestedDate);
    if (fb) {
      setCached(requestedDate, fb);
      return successJson(fb, rateLimit);
    }
    return errorJson("Servizio NASA temporaneamente non disponibile. Riprova più tardi.", "UPSTREAM_ERROR", 502, rateLimit);
  }

  // Gestisci status APOD
  if (apodRes.status === 429 || apodRes.status === 403) {
    // Prova fallback prima di rispondere RATE_LIMIT, ma se fallback ha successo ritorna fallback
    const fb = await fetchFallback(requestedDate);
    if (fb) {
      setCached(requestedDate, fb);
      return successJson(fb, rateLimit);
    }
    return errorJson("Limite richieste NASA raggiunto. Riprova tra qualche minuto.", "RATE_LIMIT", 429, rateLimit);
  }

  if (apodRes.status === 400) {
    // Prova a leggere msg per confermare INVALID_DATE
    let body: ApodResponse | null = null;
    try {
      body = (await apodRes.json()) as ApodResponse;
    } catch {
      // ignore
    }
    if (body?.msg || body?.code === 400) {
      return errorJson(body.msg ?? "Data non valida per APOD.", "INVALID_DATE", 400, rateLimit);
    }
    return errorJson("Richiesta non valida.", "INVALID_DATE", 400, rateLimit);
  }

  if (!apodRes.ok) {
    // Altri errori upstream -> fallback
    const fb = await fetchFallback(requestedDate);
    if (fb) {
      setCached(requestedDate, fb);
      return successJson(fb, rateLimit);
    }
    return errorJson("Errore nel recupero dell'immagine NASA.", "UPSTREAM_ERROR", 502, rateLimit);
  }

  let apod: ApodResponse;
  try {
    apod = (await apodRes.json()) as ApodResponse;
  } catch {
    const fb = await fetchFallback(requestedDate);
    if (fb) {
      setCached(requestedDate, fb);
      return successJson(fb, rateLimit);
    }
    return errorJson("Risposta NASA non valida.", "UPSTREAM_ERROR", 502, rateLimit);
  }

  // 4) se media_type image e url valido -> ritorna APOD
  if (apod.media_type === "image" && (apod.hdurl || apod.url)) {
    const imageUrl = apod.hdurl || apod.url!;
    // Escludi raw/FITS se per caso — usa helper centralizzato per non-match
    // di falsi positivi tipo "rawr-image.jpg".
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
      return successJson(result, rateLimit);
    }
  }

  // 5) media_type !== image o url non valido -> fallback
  const fb = await fetchFallback(requestedDate);
  if (fb) {
    setCached(requestedDate, fb);
    return successJson(fb, rateLimit);
  }

  return errorJson("Nessuna immagine trovata per questa data.", "NOT_FOUND", 404, rateLimit);
}

// ---------- exports GET / POST ----------

export async function GET(request: NextRequest): Promise<NextResponse> {
  const ip = getClientIp(request);
  const rateLimit = checkRateLimit(ip);

  if (!rateLimit.allowed) {
    const res = NextResponse.json(
      { error: "Troppe richieste, riprova tra un minuto.", code: "RATE_LIMIT" },
      { status: 429 }
    );
    applyRateLimitHeaders(res, rateLimit);
    return res;
  }

  const date = request.nextUrl.searchParams.get("date") ?? undefined;
  if (!date) {
    return errorJson("Parametro 'date' mancante. Usa ?date=YYYY-MM-DD.", "INVALID_DATE", 400, rateLimit);
  }
  return handleAstro(date, rateLimit);
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const ip = getClientIp(request);
  const rateLimit = checkRateLimit(ip);

  if (!rateLimit.allowed) {
    const res = NextResponse.json(
      { error: "Troppe richieste, riprova tra un minuto.", code: "RATE_LIMIT" },
      { status: 429 }
    );
    applyRateLimitHeaders(res, rateLimit);
    return res;
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    // Se body non JSON, prova query param come fallback
    const qp = request.nextUrl.searchParams.get("date");
    if (qp) return handleAstro(qp, rateLimit);
    return errorJson("Body JSON non valido. Invia { date: 'YYYY-MM-DD' }.", "INVALID_DATE", 400, rateLimit);
  }

  const date =
    (body as Record<string, unknown>)?.["date"] ??
    request.nextUrl.searchParams.get("date") ??
    undefined;

  if (typeof date !== "string" || !date) {
    return errorJson("Campo 'date' mancante. Invia { date: 'YYYY-MM-DD' }.", "INVALID_DATE", 400, rateLimit);
  }

  return handleAstro(date, rateLimit);
}