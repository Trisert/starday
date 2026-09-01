import { NextRequest, NextResponse } from "next/server";

export const revalidate = 0;
export const dynamic = "force-dynamic";

// --- Contract types ---
export interface AstroSuccess {
  imageUrl: string;
  title: string;
  caption: string;
  source: string;
  creditedTo: string;
  actualDate: string;
  isFallback: boolean;
  requestedDate: string;
}

interface AstroErrorBody {
  error: string;
  code: string;
}

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

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

function validateDate(date: string): { valid: true; date: string } | { valid: false; error: string; code: string } {
  if (!DATE_REGEX.test(date)) {
    return { valid: false, error: "Formato data non valido. Usa YYYY-MM-DD.", code: "INVALID_DATE" };
  }
  const d = new Date(date + "T00:00:00Z");
  if (isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== date) {
    return { valid: false, error: "Data non valida.", code: "INVALID_DATE" };
  }
  // APOD disponibile dal 1995-06-16 — ma per fallback accettiamo anche prima; validazione minima: non futura
  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10);
  if (date > todayStr) {
    return { valid: false, error: "La data non può essere nel futuro.", code: "INVALID_DATE" };
  }
  return { valid: true, date };
}

function getApiKey(): string | null {
  const key = process.env.NASA_API_KEY || (process.env.NODE_ENV === "development" ? "DEMO_KEY" : null);
  return key ?? null;
}

function errorJson(message: string, code: string, status: number): NextResponse<AstroErrorBody> {
  return NextResponse.json({ error: message, code }, { status });
}

function daysDiff(a: string, b: string): number {
  const da = new Date(a + "T00:00:00Z").getTime();
  const db = new Date(b + "T00:00:00Z").getTime();
  return Math.abs(da - db) / (1000 * 60 * 60 * 24);
}

// ---------- fallback logic ----------

async function fetchFallback(requestedDate: string): Promise<AstroSuccess | null> {
  const year = requestedDate.slice(0, 4);
  const url =
    `https://images-api.nasa.gov/search` +
    `?q=Hubble%20Space%20Telescope+OR+James%20Webb%20Space%20Telescope` +
    `&media_type=image` +
    `&year_start=${year}` +
    `&year_end=${year}`;

  let res: Response;
  try {
    res = await fetch(url, { cache: "no-store" });
  } catch {
    return null;
  }

  if (!res.ok) return null;

  let data: NasaImagesSearchResponse;
  try {
    data = (await res.json()) as NasaImagesSearchResponse;
  } catch {
    return null;
  }

  const items = data.collection?.items;
  if (!items || items.length === 0) return null;

  // Scegli item con date_created più vicino a requestedDate
  let bestIdx = 0;
  let bestDiff = Infinity;

  for (let i = 0; i < items.length; i++) {
    const dc = items[i].data?.[0]?.date_created;
    if (!dc) continue;
    // date_created è ISO datetime es. 2021-03-15T00:00:00Z
    const isoDate = dc.slice(0, 10);
    if (!DATE_REGEX.test(isoDate)) continue;
    const diff = daysDiff(isoDate, requestedDate);
    if (diff < bestDiff) {
      bestDiff = diff;
      bestIdx = i;
    }
  }

  const best = items[bestIdx];
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

async function handleAstro(requestedDate: string): Promise<NextResponse<AstroSuccess | AstroErrorBody>> {
  // 1) valida data
  const v = validateDate(requestedDate);
  if (!v.valid) {
    return errorJson(v.error, v.code, 400);
  }

  // 2) api key
  const key = getApiKey();
  if (!key) {
    return errorJson("Configurazione server mancante. Contatta l'amministratore.", "CONFIG_ERROR", 500);
  }

  // 3) fetch APOD
  const apodUrl = `https://api.nasa.gov/planetary/apod?date=${requestedDate}&api_key=${key}&thumbs=false`;

  let apodRes: Response;
  try {
    apodRes = await fetch(apodUrl, { cache: "no-store" });
  } catch {
    // Errore rete -> tenta fallback
    const fb = await fetchFallback(requestedDate);
    if (fb) return NextResponse.json(fb, { status: 200 });
    return errorJson("Servizio NASA temporaneamente non disponibile. Riprova più tardi.", "UPSTREAM_ERROR", 502);
  }

  // Gestisci status APOD
  if (apodRes.status === 429 || apodRes.status === 403) {
    // Prova fallback prima di rispondere RATE_LIMIT, ma se fallback ha successo ritorna fallback
    const fb = await fetchFallback(requestedDate);
    if (fb) return NextResponse.json(fb, { status: 200 });
    return errorJson("Limite richieste NASA raggiunto. Riprova tra qualche minuto.", "RATE_LIMIT", 429);
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
      return errorJson(body.msg ?? "Data non valida per APOD.", "INVALID_DATE", 400);
    }
    return errorJson("Richiesta non valida.", "INVALID_DATE", 400);
  }

  if (!apodRes.ok) {
    // Altri errori upstream -> fallback
    const fb = await fetchFallback(requestedDate);
    if (fb) return NextResponse.json(fb, { status: 200 });
    return errorJson("Errore nel recupero dell'immagine NASA.", "UPSTREAM_ERROR", 502);
  }

  let apod: ApodResponse;
  try {
    apod = (await apodRes.json()) as ApodResponse;
  } catch {
    const fb = await fetchFallback(requestedDate);
    if (fb) return NextResponse.json(fb, { status: 200 });
    return errorJson("Risposta NASA non valida.", "UPSTREAM_ERROR", 502);
  }

  // 4) se media_type image e url valido -> ritorna APOD
  if (apod.media_type === "image" && (apod.hdurl || apod.url)) {
    const imageUrl = apod.hdurl || apod.url!;
    // Escludi raw/FITS se per caso
    if (imageUrl.endsWith(".fits") || imageUrl.includes("raw")) {
      // tratta come non-image -> fallback
    } else {
      const result: AstroSuccess = {
        imageUrl,
        title: apod.title,
        caption: (apod.explanation ?? "").slice(0, 300),
        source: "NASA APOD",
        creditedTo: apod.copyright ?? "NASA",
        actualDate: apod.date,
        isFallback: false,
        requestedDate,
      };
      return NextResponse.json(result, { status: 200 });
    }
  }

  // 5) media_type !== image o url non valido -> fallback
  const fb = await fetchFallback(requestedDate);
  if (fb) return NextResponse.json(fb, { status: 200 });

  return errorJson("Nessuna immagine trovata per questa data.", "NOT_FOUND", 404);
}

// ---------- exports GET / POST ----------

export async function GET(request: NextRequest): Promise<NextResponse> {
  const date = request.nextUrl.searchParams.get("date") ?? undefined;
  if (!date) {
    return errorJson("Parametro 'date' mancante. Usa ?date=YYYY-MM-DD.", "INVALID_DATE", 400);
  }
  return handleAstro(date);
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    // Se body non JSON, prova query param come fallback
    const qp = request.nextUrl.searchParams.get("date");
    if (qp) return handleAstro(qp);
    return errorJson("Body JSON non valido. Invia { date: 'YYYY-MM-DD' }.", "INVALID_DATE", 400);
  }

  const date =
    (body as Record<string, unknown>)?.["date"] ??
    request.nextUrl.searchParams.get("date") ??
    undefined;

  if (typeof date !== "string" || !date) {
    return errorJson("Campo 'date' mancante. Invia { date: 'YYYY-MM-DD' }.", "INVALID_DATE", 400);
  }

  return handleAstro(date);
}
