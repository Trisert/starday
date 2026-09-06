"use client";

import { useState, useMemo, useEffect, useRef } from "react";
import type { AstroSuccess, AstroErrorBody } from "@/lib/astro-types";
import { MIN_API_DATE } from "@/lib/astro-types";
import { DateForm } from "@/components/DateForm";
import PlateResult from "@/components/PlateResult";

const MIN_DATE = MIN_API_DATE;

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
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
 * Static canvas starfield — painted once, no rAF loop, no aurora blobs.
 * Archival Dossier uses a flat #0b0c0e background; the canvas is a single
 * deterministic star field that survives prefers-reduced-motion natively.
 */
function Starfield() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.floor(window.innerWidth * dpr);
    canvas.height = Math.floor(window.innerHeight * dpr);
    canvas.style.width = `${window.innerWidth}px`;
    canvas.style.height = `${window.innerHeight}px`;

    const count = Math.min(220, Math.floor((window.innerWidth * window.innerHeight) / 9000));
    // Paint once — no rAF loop. Static alpha distribution mimics the
    // mean twinkle of the animated version without burning CPU.
    for (let i = 0; i < count; i++) {
      const x = Math.random() * canvas.width;
      const y = Math.random() * canvas.height;
      const r = (Math.random() * 1.1 + 0.3) * dpr;
      const alpha = 0.45 + Math.random() * 0.45;
      ctx.globalAlpha = alpha;
      ctx.fillStyle = "#e8ecff";
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 -z-10 opacity-50"
    />
  );
}

export default function Home() {
  const today = useMemo(() => todayISO(), []);
  const [date, setDate] = useState<string>(initialDateFromUrl);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<AstroSuccess | null>(null);
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

  function handleDateChange(v: string) {
    setDate(v);
    setError(null);
  }

  return (
    <div className="relative flex min-h-screen flex-col text-zinc-100">
      <Starfield />

      {/* Header — dossier index row */}
      <header className="mx-auto w-full max-w-3xl px-4 pt-6 pb-4 sm:px-6 sm:pt-8">
        <div className="flex items-center justify-between gap-4 border-b border-white/10 pb-3">
          <span className="font-mono text-[11px] font-medium tracking-[0.22em] text-zinc-200 uppercase">
            Starday Plate Index
          </span>
          <span className="font-mono text-[11px] font-medium tracking-[0.22em] text-zinc-500 uppercase">
            NASA APOD Image Library
          </span>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 px-4 pb-14 sm:px-6">
        {/* Card form */}
        <div className="border border-white/10 bg-[#0f1011] p-5 sm:p-7">
          <DateForm
            date={date}
            today={today}
            minDate={MIN_DATE}
            validationError={validationError}
            loading={loading}
            onSubmit={onSubmit}
            onDateChange={handleDateChange}
          />
          {/* Error */}
          {error && (
            <div
              id="server-error"
              role="alert"
              className="mt-5 border border-red-500/25 bg-red-500/10 px-4 py-3 text-sm leading-5 text-red-200"
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
              <div className="h-[280px] border border-white/10 bg-white/5 sm:h-[380px]" />
              <div className="h-6 w-3/4 border border-white/10 bg-white/5" />
              <div className="h-4 w-full border border-white/10 bg-white/5" />
              <div className="h-4 w-5/6 border border-white/10 bg-white/5" />
            </div>
          )}
        </div>

        {/* Risultato */}
        {data && !loading && (
          <div ref={resultRef} tabIndex={-1} className="focus:outline-none">
            <PlateResult
              key={data.imageUrl}
              data={data}
              shareUrl={getShareUrl(data.requestedDate)}
              onShare={handleShare}
            />
          </div>
        )}

        {/* Footer info */}
        <p className="mt-10 text-center font-mono text-[11px] leading-5 tracking-wide text-[#62666d]">
          DATA FROM NASA APOD &amp; NASA IMAGE LIBRARY
          <br />
          IMAGERY © RESPECTIVE OWNERS, SHOWN WITH CREDIT · NOT AFFILIATED WITH NASA
          <br />
          NO TRACKING · NO COOKIES · NO ACCOUNTS
        </p>
      </main>

      {/* Toast (single live region — role=status announces politely) */}
      {toast && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-6 left-1/2 -translate-x-1/2 border border-white/15 bg-[#0f1011] rounded-full px-5 py-3 text-sm font-medium text-zinc-100"
        >
          {toast}
        </div>
      )}
    </div>
  );
}
