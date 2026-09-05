"use client";

import { useState, useMemo, useEffect, useRef } from "react";
import Image from "next/image";
import type { AstroSuccess, AstroErrorBody } from "@/lib/astro-types";
import {
  DATE_REGEX,
  MIN_API_DATE as MIN_DATE,
  todayUtcString as todayISO,
  formatDisplayDate as formatDateEN,
} from "@/lib/astro-types";

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
  if (date < MIN_DATE) return "Hubble has been in orbit since 1990, but the archive starts on 01/01/1900.";
  return "Something went wrong. Try again.";
}

// Deep-link: seed the initial date from ?date= during state init (not in an
// effect, so there is no setState-in-effect cascade). Invalid/absent param -> "".
function initialDateFromUrl(): string {
  try {
    if (typeof window === "undefined") return "";
    const params = new URLSearchParams(window.location.search);
    const d = params.get("date");
    if (d && DATE_REGEX.test(d)) {
      const todayStr = todayISO();
      if (d >= MIN_DATE && d <= todayStr) return d;
    }
  } catch {}
  return "";
}

export default function Home() {
  const today = useMemo(() => todayISO(), []);
  const [date, setDate] = useState(initialDateFromUrl);
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
    if (date < MIN_DATE) return "Date must be from 01/01/1900 onwards.";
    return null;
  }, [date, today]);

  async function fetchData(targetDate: string): Promise<void> {
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
      setError("Date must be from 01/01/1900 onwards.");
      return;
    }

    setLoading(true);
    setData(null);
    try {
      const res = await fetch(`/api/astro?date=${encodeURIComponent(targetDate)}`, {
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
        setData(json as AstroSuccess);
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

  async function onSubmit(e: React.FormEvent<HTMLFormElement>): Promise<void> {
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

  // scroll the result into view and focus it when it arrives
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

  function getShareUrl(targetDate: string): string {
    try {
      const origin = window.location.origin;
      const pathname = window.location.pathname;
      return `${origin}${pathname}?date=${encodeURIComponent(targetDate)}`;
    } catch {
      return `https://starday.vercel.app?date=${encodeURIComponent(targetDate)}`;
    }
  }

  async function handleShare(): Promise<void> {
    if (!data) return;
    const shareUrl = getShareUrl(data.requestedDate);
    if (navigator.share && window.isSecureContext) {
      try {
        await navigator.share({
          title: data.title,
          text: data.caption,
          url: shareUrl,
        });
        setToast("Shared!");
      } catch {}
    } else if (navigator.clipboard) {
      try {
        await navigator.clipboard.writeText(shareUrl);
        setToast("Link copied!");
      } catch {
        setToast("Could not copy the link.");
      }
    } else {
      setToast("Copy not available in this browser.");
    }
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col">
      {/* Header */}
      <header className="w-full max-w-3xl mx-auto px-4 sm:px-6 pt-10 pb-6">
        <p className="text-center text-xs tracking-[0.2em] uppercase text-zinc-400 font-medium">
          NASA · Hubble · JWST · APOD
        </p>
        <h1 className="mt-3 text-center text-[28px] sm:text-[34px] font-bold leading-tight tracking-tight text-zinc-50">
          What photo did Hubble take
          <br className="hidden sm:block" />
          <span className="sm:hidden"> </span>
          on the day you were born?
        </h1>
        <p className="mt-3 text-center text-sm sm:text-[15px] leading-6 text-zinc-400 max-w-xl mx-auto">
          Enter your birthdate and discover the space
          telescope image from your day. APOD since 1995, earlier years via the NASA archive.
        </p>
      </header>

      <main className="w-full max-w-3xl mx-auto px-4 sm:px-6 pb-12 flex-1">
        {/* Card form */}
        <div className="rounded-2xl bg-zinc-900 border border-zinc-800 shadow-2xl p-5 sm:p-7">
          <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
            <label htmlFor="birthdate" className="text-sm font-medium text-zinc-200">
              Your birthdate
            </label>

            <div className="flex flex-col sm:flex-row gap-3">
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
                  className="w-full rounded-xl bg-zinc-950 border border-zinc-800 px-4 py-3 text-[15px] text-zinc-100 placeholder:text-zinc-500 outline-none focus:border-zinc-600 focus:ring-2 focus:ring-zinc-700/50 transition"
                />
                <p id="date-hint" className="mt-2 text-xs text-zinc-400">
                  Min 01/01/1900 — Max today ({formatDateEN(today)})
                </p>
              </div>

              <button
                type="submit"
                disabled={loading || !!validationError || !date}
                className="inline-flex items-center justify-center rounded-xl bg-white px-6 py-3 text-sm font-semibold text-zinc-900 shadow hover:bg-zinc-100 disabled:opacity-40 disabled:cursor-not-allowed transition shrink-0 sm:self-start min-w-[170px] h-[46px]"
              >
                {loading ? (
                  <span className="inline-flex items-center gap-2">
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-zinc-300 border-t-zinc-900" />
                    Loading...
                  </span>
                ) : (
                  "Show my photo"
                )}
              </button>
            </div>

            {validationError && date && !loading && (
              <p id="date-error" className="text-sm text-amber-400" role="alert">
                {validationError}
              </p>
            )}
          </form>
          {/* Error */}
          {error && (
            <div
              id="server-error"
              role="alert"
              className="mt-5 rounded-xl border border-red-900/50 bg-red-950/40 px-4 py-3 text-sm leading-5 text-red-200"
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
              className="mt-6 animate-pulse space-y-4"
              role="status"
              aria-live="polite"
              aria-busy="true"
            >
              <div className="h-[280px] sm:h-[380px] rounded-xl bg-zinc-800" />
              <div className="h-6 w-3/4 rounded bg-zinc-800" />
              <div className="h-4 w-full rounded bg-zinc-800" />
              <div className="h-4 w-5/6 rounded bg-zinc-800" />
            </div>
          )}
        </div>

        {/* Result */}
        {data && !loading && (
          <div
            ref={resultRef}
            tabIndex={-1}
            className="mt-6 rounded-2xl bg-zinc-900 border border-zinc-800 overflow-hidden shadow-2xl focus:outline-none"
            aria-live="polite"
          >
            {/* Image */}
            <div className="relative bg-black w-full h-[280px] sm:h-[380px] max-h-[70vh] overflow-hidden">
              {imgError ? (
                <div
                  role="alert"
                  className="w-full min-h-[280px] sm:min-h-[380px] flex items-center justify-center p-6 text-sm text-red-300 bg-red-950/30"
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

            <div className="p-5 sm:p-7 space-y-4">
              {/* Badge + date */}
              <div className="flex flex-wrap items-center gap-2">
                {data.isFallback ? (
                  <span className="inline-flex items-center rounded-full bg-amber-500/15 border border-amber-500/30 px-3 py-1 text-xs font-medium text-amber-300">
                    Closest image — {data.actualDate.slice(0, 4)}
                  </span>
                ) : (
                  <span className="inline-flex items-center rounded-full bg-emerald-500/15 border border-emerald-500/30 px-3 py-1 text-xs font-medium text-emerald-300">
                    Exact date
                  </span>
                )}
                <span className="text-xs text-zinc-400">
                  Requested: {formatDateEN(data.requestedDate)} · Shown:{" "}
                  {formatDateEN(data.actualDate)}
                </span>
              </div>

              <h2 className="text-xl sm:text-2xl font-semibold leading-tight text-zinc-50">
                {data.title}
              </h2>

              <p className="text-sm sm:text-[15px] leading-6 text-zinc-300">
                {data.caption}
              </p>

              <div className="flex flex-col gap-1 pt-2 border-t border-zinc-800 text-xs text-zinc-400">
                <span>
                  Source: <span className="text-zinc-300">{data.source}</span>
                </span>
                <span>
                  Credits: <span className="text-zinc-300">{data.creditedTo}</span>
                </span>
                <span>
                  Image date: <span className="text-zinc-300">{data.actualDate}</span>
                </span>
              </div>

              <div className="pt-3 flex flex-wrap gap-3">
                <a
                  href={data.imageUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center justify-center rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-zinc-900 hover:bg-zinc-100 transition"
                >
                  Open HD
                </a>
                <button
                  type="button"
                  onClick={handleShare}
                  className="inline-flex items-center justify-center rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-2.5 text-sm font-medium text-zinc-200 hover:bg-zinc-800 transition"
                >
                  Share
                </button>
              </div>

              {data.isFallback && (
                <p className="text-xs leading-5 text-zinc-400 bg-zinc-950 rounded-xl px-3 py-2 border border-zinc-800">
                  No APOD image was available for this date
                  (video or missing data). Showing the closest Hubble/JWST photo
                  from {data.actualDate.slice(0, 4)} in the NASA Image Library archive.
                </p>
              )}
            </div>
          </div>
        )}

        {/* Footer info */}
        <p className="mt-8 text-center text-xs leading-5 text-zinc-500">
          Data from NASA APOD &amp; NASA Image Library. No API key exposed to the client.
          <br />
          Hubble in orbit since 1990 · APOD since 06/16/1995 · JWST since 2022.
        </p>
      </main>

      {/* Toast (single live region — role=status announces politely) */}
      {toast && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-6 left-1/2 -translate-x-1/2 rounded-full bg-zinc-900 border border-zinc-700 px-5 py-3 text-sm font-medium text-zinc-100 shadow-2xl"
        >
          {toast}
        </div>
      )}
    </div>
  );
}
