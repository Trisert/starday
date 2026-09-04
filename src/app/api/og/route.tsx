import { ImageResponse } from "next/og";
import type { NextRequest } from "next/server";
import { formatDisplayDate } from "@/lib/date";
import { buildStars, OG_HEIGHT, OG_WIDTH, ogCacheControl, resolveOgDate } from "@/lib/og-helpers";

// No `export const revalidate`: the card date defaults to today (mutable),
// so responses must not sit in the route cache for 24h. CDN caching is
// driven per-response via Cache-Control in ogCacheControl() instead
// (long + immutable for past dates, 1h for today).

// --- Route ---

export async function GET(request: NextRequest): Promise<Response> {
  const raw = request.nextUrl.searchParams.get("date");
  const date = resolveOgDate(raw);
  const dateLong = formatDisplayDate(date);
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
              StarDay
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
              {dateLong}
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
              Discover the photo the space telescope captured on your birthday.
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
            <div style={{ display: "flex" }}>starday.vercel.app</div>
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
        width: OG_WIDTH,
        height: OG_HEIGHT,
        headers: {
          // Past-date cards are immutable (long CDN cache); today's card is
          // revalidated hourly so it never goes stale (see ogCacheControl).
          "Cache-Control": ogCacheControl(date),
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
