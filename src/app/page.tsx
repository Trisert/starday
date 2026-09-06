"use client";

import { useState, useMemo, useEffect, useRef } from "react";
import Image from "next/image";
import type { AstroSuccess, AstroErrorBody } from "@/lib/astro-types";
import { MIN_API_DATE } from "@/lib/astro-types";

const MIN_DATE = MIN_API_DATE;

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function formatDateEN(iso: string): string {
  try {
    return new Date(iso + "T12:00:00").toLocaleDateString("en-US", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}

function mapErrorMessage(status: number, body: AstroErrorBody | null, date: string): string {
  if (body?.error) {
    // server messages are already user-friendly
    if (body.code === "RATE_LIMIT" || status === 429) {
      return "Too many requests — try again in a minute. (NASA API limit reached)";
    }
    return body.error;
  }
  if (status === 429) return "Too many requests. Wait a few seconds and try again.";
  if (status === 404) return "No image found for this date. Try another day.";
  if (status === 400) return "Invalid date. Check the format.";
  if (status >= 500) return "NASA service temporarily unavailable. Try again later.";
  // client-side validation fallback
  if (date > todayISO()) return "You cannot pick a future date.";
  if (date < MIN_DATE) return "No space photos exist before 10/04/1957 (Sputnik 1).";
  return "Something went wrong. Try again.";
}

// Deep-link: seed the initial date from ?date= during state init (not in an
// effect, so there is no setState-in-effect cascade). Invalid/absent param -> "".
function initialDateFromUrl(): string {
  try {
    if (typeof window === "undefined") return "";
    const params = new URLSearchParams(window.location.search);
    const d = params.get("date");
    if (d && /^\d{4}-\d{2}-\d{2}$/.test(d)) {
      const todayStr = new Date().toISOString().slice(0, 10);
      if (d >= MIN_DATE && d <= todayStr) return d;
    }
  } catch {}
  return "";
}

/**
 * Fixed canvas starfield behind the page. Imperative twinkle — no React
 * state involved. Static frame when the user prefers reduced motion.
 */
function Starfield() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let raf = 0;
    let stars: { x: number; y: number; r: number; p: number; s: number }[] = [];

    const resize = () => {
      canvas.width = Math.floor(window.innerWidth * dpr);
      canvas.height = Math.floor(window.innerHeight * dpr);
      canvas.style.width = `${window.innerWidth}px`;
      canvas.style.height = `${window.innerHeight}px`;
      const count = Math.min(220, Math.floor((window.innerWidth * window.innerHeight) / 9000));
      stars = Array.from({ length: count }, () => ({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        r: (Math.random() * 1.1 + 0.3) * dpr,
        p: Math.random() * Math.PI * 2,
        s: 0.4 + Math.random() * 1.2,
      }));
    };

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const draw = (t: number) => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      for (const st of stars) {
        const tw = reduced ? 0.7 : 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(st.p + (t / 1000) * st.s));
        ctx.globalAlpha = tw;
        ctx.fillStyle = "#e8ecff";
        ctx.beginPath();
        ctx.arc(st.x, st.y, st.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      if (!reduced) raf = requestAnimationFrame(draw);
    };

    resize();
    draw(0);
    window.addEventListener("resize", resize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 -z-10 opacity-70"
    />
  );
}

export default function Home() {
  const today = useMemo(() => todayISO(), []);
  const [date, setDate] = useState<string>(initialDateFromUrl);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<AstroSuccess | null>(null);
  const [imgError, setImgError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const resultRef = useRef<HTMLDivElement>(null);

  // live validation to disable the button and show a hint
  const validationError = useMemo(() => {
    if (!date) return null;
    if (date > today) return "Date cannot be in the future.";
    if (date < MIN_DATE) return "Date must be from 10/04/1957 onwards (start of the space age).";
    return null;
  }, [date, today]);

  async function fetchData(targetDate: string) {
    setError(null);
    if (!targetDate) {
      setError("Select a date.");
      return;
    }
    if (targetDate > today) {
      setError("Date cannot be in the future.");
      return;
    }
    if (targetDate < MIN_DATE) {
      setError("Date must be from 10/04/1957 onwards (start of the space age).");
      return;
    }

    setLoading(true);
    setData(null);
    try {
      const res = await fetch(`/api/astro?date=${encodeURIComponent(targetDate)}`, {
        method: "GET",
        headers: { Accept: "application/json" },
      });

      const json = await res.json().catch(() => null);

      if (!res.ok) {
        const msg = mapErrorMessage(res.status, json as AstroErrorBody | null, targetDate);
        setError(msg);
        return;
      }

      if (json && typeof json.imageUrl === "string" && typeof json.title === "string") {
        setImgError(null);
        const success = json as AstroSuccess;
        setData(success);
        // deep-link: push history.replaceState
        try {
          const url = new URL(window.location.href);
          url.searchParams.set("date", targetDate);
          history.replaceState(null, "", url.toString());
        } catch {}
      } else if (json && (json as AstroErrorBody).error) {
        setError((json as AstroErrorBody).error);
      } else {
        setError("Unexpected server response. Try again.");
      }
    } catch (err) {
      const isNotReady =
        err instanceof TypeError && String(err.message).toLowerCase().includes("fetch");
      setError(
        isNotReady
          ? "Service temporarily unavailable. Try again shortly."
          : "Network error. Check your connection and try again."
      );
    } finally {
      setLoading(false);
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    await fetchData(date);
  }

  useEffect(() => {
    if (date) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional mount sync: URL ?date= -> fetch
      void fetchData(date);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // scrollIntoView + focus quando data arriva
  useEffect(() => {
    if (data && resultRef.current) {
      resultRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
      resultRef.current.focus({ preventScroll: true });
    }
  }, [data]);

  // auto-dismiss toast
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2500);
    return () => clearTimeout(t);
  }, [toast]);

  function showToast(msg: string) {
    setToast(msg);
  }

  function getShareUrl(targetDate: string): string {
    try {
      const origin = window.location.origin;
      const pathname = window.location.pathname;
      return `${origin}${pathname}?date=${encodeURIComponent(targetDate)}`;
    } catch {
      return `https://starday.vercel.app?date=${encodeURIComponent(targetDate)}`;
    }
  }

  async function handleShare() {
    if (!data) return;
    const shareUrl = getShareUrl(data.requestedDate);
    if (navigator.share && window.isSecureContext) {
      try {
        await navigator.share({
          title: data.title,
          text: data.caption,
          url: shareUrl,
        });
        showToast("Shared!");
      } catch {}
    } else if (navigator.clipboard) {
      try {
        await navigator.clipboard.writeText(shareUrl);
        showToast("Link copied!");
      } catch {
        showToast("Could not copy the link.");
      }
    } else {
      showToast("Copy not available in this browser.");
    }
  }

  return (
    <div className="relative flex min-h-screen flex-col text-zinc-100">
      <Starfield />
      {/* Aurora ambience */}
      <div aria-hidden="true" className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        <div className="aurora-drift absolute -top-40 left-1/2 h-[480px] w-[820px] -translate-x-1/2 rounded-full bg-[#5e6ad2]/20 blur-[140px]" />
        <div className="aurora-drift absolute top-1/3 -left-40 h-[380px] w-[380px] rounded-full bg-[#a855f7]/10 blur-[120px]" />
        <div className="aurora-drift absolute -right-40 bottom-0 h-[420px] w-[420px] rounded-full bg-[#ec4899]/10 blur-[130px]" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_35%,rgba(8,9,10,0.85)_100%)]" />
      </div>

      {/* Header */}
      <header className="mx-auto w-full max-w-3xl px-4 pt-14 pb-8 sm:px-6 sm:pt-20">
        <p className="text-center font-mono text-[11px] font-medium tracking-[0.3em] text-[#828fff] uppercase">
          NASA · Hubble · JWST · APOD
        </p>
        <h1 className="display-tight mt-4 text-center text-[38px] leading-[1.05] font-semibold text-[#f7f8f8] sm:text-[60px]">
          The universe on
          <br />
          the day <span className="text-aurora">you were born</span>
        </h1>
        <p className="mx-auto mt-4 max-w-xl text-center text-[15px] leading-7 text-[#8a8f98] sm:text-base">
          Enter your birthdate and discover the space telescope image from your
          day. APOD since 1995, earlier years via the NASA archive.
        </p>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 px-4 pb-14 sm:px-6">
        {/* Card form */}
        <div className="glass rounded-[20px] p-5 sm:p-7">
          <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
            <label htmlFor="birthdate" className="text-sm font-medium text-[#d0d6e0]">
              Your birthdate
            </label>

            <div className="flex flex-col gap-3 sm:flex-row">
              <div className="flex-1">
                <input
                  id="birthdate"
                  type="date"
                  value={date}
                  onChange={(e) => {
                    setDate(e.target.value);
                    setError(null);
                    setImgError(null);
                  }}
                  min={MIN_DATE}
                  max={today}
                  required
                  aria-describedby={validationError ? "date-hint date-error" : "date-hint"}
                  className="w-full rounded-xl border border-white/10 bg-black/40 px-4 py-3 text-[15px] text-zinc-100 transition outline-none placeholder:text-zinc-500 focus:border-[#7170ff]/60 focus:ring-2 focus:ring-[#7170ff]/25"
                />
                <p id="date-hint" className="mt-2 font-mono text-[11px] tracking-wide text-[#62666d]">
                  Min 10/04/1957 — Max today ({formatDateEN(today)})
                </p>
              </div>

              <button
                type="submit"
                disabled={loading || !!validationError || !date}
                className="btn-aurora inline-flex h-[46px] min-w-[170px] shrink-0 items-center justify-center rounded-xl px-6 text-sm font-semibold text-white transition disabled:cursor-not-allowed disabled:opacity-40 sm:self-start"
              >
                {loading ? (
                  <span className="inline-flex items-center gap-2">
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                    Loading...
                  </span>
                ) : (
                  "Show my photo"
                )}
              </button>
            </div>

            {validationError && date && !loading && (
              <p id="date-error" className="text-sm text-amber-300" role="alert">
                {validationError}
              </p>
            )}
          </form>
          {/* Error */}
          {error && (
            <div
              id="server-error"
              role="alert"
              className="mt-5 rounded-xl border border-red-500/25 bg-red-500/10 px-4 py-3 text-sm leading-5 text-red-200"
            >
              {error}
              {(error.toLowerCase().includes("429") ||
                error.toLowerCase().includes("too many")) && (
                <p className="mt-1 text-xs text-red-300/80">
                  Tip: wait 30-60 seconds and try again.
                </p>
              )}
            </div>
          )}

          {/* Loading skeleton while fetching */}
          {loading && (
            <div
              className="mt-6 space-y-4"
              role="status"
              aria-live="polite"
              aria-busy="true"
            >
              <div className="shimmer h-[280px] rounded-xl sm:h-[380px]" />
              <div className="shimmer h-6 w-3/4 rounded" />
              <div className="shimmer h-4 w-full rounded" />
              <div className="shimmer h-4 w-5/6 rounded" />
            </div>
          )}
        </div>

        {/* Risultato */}
        {data && !loading && (
          <div
            ref={resultRef}
            tabIndex={-1}
            className="rise-in glass mt-6 overflow-hidden rounded-[20px] focus:outline-none"
            aria-live="polite"
          >
            {/* Image */}
            <div className="relative max-h-[70vh] h-[280px] w-full overflow-hidden bg-black sm:h-[420px]">
              <div
                aria-hidden="true"
                className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(94,106,210,0.18),transparent_70%)]"
              />
              {imgError ? (
                <div
                  role="alert"
                  className="flex min-h-[280px] w-full items-center justify-center bg-red-950/30 p-6 text-sm text-red-300 sm:min-h-[420px]"
                >
                  {imgError}
                </div>
              ) : (
                <Image
                  src={data.imageUrl}
                  alt={data.title}
                  fill
                  className="object-contain"
                  sizes="(max-width: 768px) 100vw, 768px"
                  priority
                  referrerPolicy="no-referrer"
                  onError={() => setImgError("Image unavailable")}
                />
              )}
            </div>

            <div className="space-y-4 p-5 sm:p-7">
              {/* Badge + date */}
              <div className="flex flex-wrap items-center gap-2">
                {data.isFallback ? (
                  <span className="inline-flex items-center rounded-full border border-amber-400/25 bg-amber-400/10 px-3 py-1 font-mono text-[11px] font-medium tracking-wide text-amber-300">
                    ✦ CLOSEST IMAGE — {data.actualDate.slice(0, 4)}
                  </span>
                ) : (
                  <span className="inline-flex items-center rounded-full border border-emerald-400/25 bg-emerald-400/10 px-3 py-1 font-mono text-[11px] font-medium tracking-wide text-emerald-300">
                    ● EXACT DATE
                  </span>
                )}
                <span className="text-xs text-[#8a8f98]">
                  Requested: {formatDateEN(data.requestedDate)} · Shown:{" "}
                  {formatDateEN(data.actualDate)}
                </span>
              </div>

              <h2 className="display-tight text-xl leading-tight font-semibold text-[#f7f8f8] sm:text-2xl">
                {data.title}
              </h2>

              <p className="text-sm leading-6 text-[#d0d6e0] sm:text-[15px] sm:leading-7">
                {data.caption}
              </p>

              <div className="grid grid-cols-1 gap-1 border-t border-white/8 pt-4 font-mono text-[11px] tracking-wide text-[#62666d] sm:grid-cols-2">
                <span>
                  SOURCE <span className="text-[#d0d6e0]">{data.source}</span>
                </span>
                <span>
                  IMAGE DATE <span className="text-[#d0d6e0]">{data.actualDate}</span>
                </span>
                <span className="sm:col-span-2">
                  CREDITS <span className="text-[#d0d6e0]">{data.creditedTo}</span>
                </span>
              </div>

              <div className="flex flex-wrap gap-3 pt-1">
                <a
                  href={data.imageUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center justify-center rounded-xl bg-[#f7f8f8] px-4 py-2.5 text-sm font-semibold text-zinc-900 transition hover:bg-white"
                >
                  Open HD ↗
                </a>
                <button
                  type="button"
                  onClick={handleShare}
                  className="inline-flex items-center justify-center rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-medium text-zinc-200 transition hover:bg-white/10"
                >
                  Share
                </button>
              </div>

              {data.isFallback && (
                <p className="rounded-xl border border-white/8 bg-black/30 px-3 py-2 text-xs leading-5 text-[#8a8f98]">
                  No APOD image was available for this date (video or missing
                  data). Showing the closest Hubble/JWST photo from{" "}
                  {data.actualDate.slice(0, 4)} in the NASA Image Library archive.
                </p>
              )}
            </div>
          </div>
        )}

        {/* Footer info */}
        <p className="mt-10 text-center font-mono text-[11px] leading-5 tracking-wide text-[#62666d]">
          DATA FROM NASA APOD &amp; NASA IMAGE LIBRARY · NO API KEY EXPOSED
          <br />
          SPACE AGE SINCE 1957 · HUBBLE SINCE 1990 · APOD SINCE 06/16/1995 · JWST SINCE 2022
        </p>
      </main>

      {/* Toast (single live region — role=status announces politely) */}
      {toast && (
        <div
          role="status"
          aria-live="polite"
          className="glass fixed bottom-6 left-1/2 -translate-x-1/2 rounded-full px-5 py-3 text-sm font-medium text-zinc-100"
        >
          {toast}
        </div>
      )}
    </div>
  );
}
