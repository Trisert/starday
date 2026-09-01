import { ImageResponse } from "next/og";
import type { NextRequest } from "next/server";

// Cache the rendered image for 24 hours (per OG route revalidate spec).
export const revalidate = 86400;

// --- Date helpers ---

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Validate a YYYY-MM-DD string. Returns the canonical date on success or `null`
 * for any failure (bad format, invalid calendar date, future date).
 */
function parseDate(raw: string | null): string | null {
  if (!raw || !DATE_REGEX.test(raw)) return null;
  const d = new Date(`${raw}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  if (d.toISOString().slice(0, 10) !== raw) return null;
  const today = new Date().toISOString().slice(0, 10);
  if (raw > today) return null;
  return raw;
}

/**
 * Format a YYYY-MM-DD string as a long Italian date (e.g. "15 aprile 1990").
 * Falls back to the original string on any error.
 */
function formatItalianDate(iso: string): string {
  try {
    const [yStr, mStr, dStr] = iso.split("-");
    const y = Number(yStr);
    const m = Number(mStr);
    const d = Number(dStr);
    const months = [
      "gennaio",
      "febbraio",
      "marzo",
      "aprile",
      "maggio",
      "giugno",
      "luglio",
      "agosto",
      "settembre",
      "ottobre",
      "novembre",
      "dicembre",
    ];
    if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return iso;
    if (m < 1 || m > 12) return iso;
    return `${d} ${months[m - 1]} ${y}`;
  } catch {
    return iso;
  }
}

// --- Star field ---

/**
 * Deterministic pseudo-random number generator (mulberry32) so the star field
 * stays stable across re-renders for the same date.
 */
function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashSeed(str: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  }
  return h >>> 0;
}

interface Star {
  x: number;
  y: number;
  size: number;
  opacity: number;
  tint: string;
}

function buildStars(date: string): Star[] {
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

// --- Route ---

export async function GET(request: NextRequest): Promise<Response> {
  const raw = request.nextUrl.searchParams.get("date");
  const validDate = parseDate(raw);
  const date = validDate ?? new Date().toISOString().slice(0, 10);
  const dateLong = formatItalianDate(date);
  const stars = buildStars(date);

  try {
    return new ImageResponse(
      (
        <div
          style={{
            width: "100%",
            height: "100%",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: "#0a0a0a",
            backgroundImage:
              "radial-gradient(ellipse at 30% 20%, rgba(59,130,246,0.18) 0%, transparent 55%), radial-gradient(ellipse at 75% 80%, rgba(168,85,247,0.15) 0%, transparent 60%)",
            fontFamily: "sans-serif",
            color: "#fafafa",
            position: "relative",
            boxSizing: "border-box",
          }}
        >
          {/* Star field — absolute positioned <div> circles (Satori doesn't support SVG injection) */}
          {stars.map((s, i) => (
            <div
              key={i}
              style={{
                position: "absolute",
                top: `${s.y}px`,
                left: `${s.x}px`,
                width: `${s.size}px`,
                height: `${s.size}px`,
                borderRadius: "999px",
                backgroundColor: s.tint,
                opacity: s.opacity,
                display: "flex",
              }}
            />
          ))}

          {/* Top-left telescope badge */}
          <div
            style={{
              position: "absolute",
              top: "44px",
              left: "64px",
              display: "flex",
              alignItems: "center",
              gap: "10px",
              fontSize: "22px",
              color: "#a1a1aa",
              letterSpacing: "2px",
            }}
          >
            <div
              style={{
                display: "flex",
                width: "12px",
                height: "12px",
                borderRadius: "999px",
                backgroundColor: "#60a5fa",
                boxShadow: "0 0 14px rgba(96,165,250,0.9)",
              }}
            />
            <span style={{ display: "flex", fontWeight: 600 }}>HUBBLE</span>
            <span style={{ display: "flex", color: "#52525b" }}>·</span>
            <span style={{ display: "flex", fontWeight: 600 }}>JWST</span>
          </div>

          {/* Top-right NASA badge */}
          <div
            style={{
              position: "absolute",
              top: "44px",
              right: "64px",
              display: "flex",
              alignItems: "center",
              gap: "10px",
              padding: "12px 20px",
              borderRadius: "999px",
              border: "1px solid rgba(255,255,255,0.18)",
              backgroundColor: "rgba(255,255,255,0.05)",
              fontSize: "20px",
              fontWeight: 700,
              letterSpacing: "3px",
              color: "#fafafa",
            }}
          >
            <span style={{ display: "flex" }}>NASA</span>
            <span style={{ display: "flex", color: "#71717a", fontWeight: 400, letterSpacing: "1px" }}>
              APOD
            </span>
          </div>

          {/* Main content */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              textAlign: "center",
              maxWidth: "980px",
              padding: "0 60px",
              zIndex: 1,
            }}
          >
            <div
              style={{
                display: "flex",
                fontSize: "28px",
                color: "#a5b4fc",
                letterSpacing: "6px",
                textTransform: "uppercase",
                marginBottom: "26px",
                fontWeight: 500,
              }}
            >
              Astronomy Picture of the Day
            </div>
            <div
              style={{
                display: "flex",
                fontSize: "72px",
                fontWeight: 800,
                lineHeight: 1.1,
                color: "#fafafa",
                textShadow: "0 4px 24px rgba(0,0,0,0.6)",
                marginBottom: "28px",
              }}
            >
              {`Hubble ti ha visto nascere`}
            </div>
            <div
              style={{
                display: "flex",
                fontSize: "60px",
                fontWeight: 700,
                lineHeight: 1,
                backgroundImage:
                  "linear-gradient(90deg, #60a5fa 0%, #a78bfa 50%, #f472b6 100%)",
                backgroundClip: "text",
                color: "transparent",
                marginBottom: "32px",
              }}
            >
              {`il ${dateLong}`}
            </div>
            <div
              style={{
                display: "flex",
                fontSize: "26px",
                color: "#d4d4d8",
                lineHeight: 1.4,
                maxWidth: "780px",
              }}
            >
              Scopri la foto che il telescopio spaziale ha catturato il giorno del tuo compleanno.
            </div>
          </div>

          {/* Bottom strip */}
          <div
            style={{
              position: "absolute",
              bottom: "44px",
              left: "64px",
              right: "64px",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              fontSize: "20px",
              color: "#a1a1aa",
              letterSpacing: "1px",
            }}
          >
            <div style={{ display: "flex" }}>hubble-compleanno.vercel.app</div>
            <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
              <span style={{ display: "flex" }}>ESA</span>
              <span style={{ display: "flex", color: "#52525b" }}>·</span>
              <span style={{ display: "flex" }}>STScI</span>
              <span style={{ display: "flex", color: "#52525b" }}>·</span>
              <span style={{ display: "flex" }}>NASA</span>
            </div>
          </div>

          {/* Accent border */}
          <div
            style={{
              position: "absolute",
              top: "24px",
              left: "24px",
              right: "24px",
              bottom: "24px",
              display: "flex",
              border: "1px solid rgba(255,255,255,0.08)",
              borderRadius: "24px",
              pointerEvents: "none",
            }}
          />
        </div>
      ),
      {
        width: 1200,
        height: 630,
        headers: {
          // Belt-and-suspenders cache headers; the route-level `revalidate`
          // export is the source of truth but these help CDNs too.
          "Cache-Control": "public, immutable, no-transform, max-age=86400",
        },
      }
    );
  } catch (err) {
    // Last-resort safety net so OG never hard-500s on the social cards.
    console.error("[api/og] failed to render image:", err);
    return new Response(`Failed to generate OG image: ${(err as Error).message}`, {
      status: 500,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
}