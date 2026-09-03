"use client";

import { useState, useMemo, useEffect, useRef } from "react";
import Image from "next/image";
import type { AstroSuccess, AstroErrorBody } from "@/lib/astro-types";

const MIN_DATE = "1995-06-16";

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function formatDateIT(iso: string): string {
  try {
    return new Date(iso + "T12:00:00").toLocaleDateString("it-IT", {
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
    // messaggi già user-friendly dal server
    if (body.code === "RATE_LIMIT" || status === 429) {
      return "Troppe richieste — riprova tra un minuto. (NASA API limite superato)";
    }
    return body.error;
  }
  if (status === 429) return "Troppe richieste. Attendi qualche secondo e riprova.";
  if (status === 404) return "Nessuna immagine trovata per questa data. Prova un altro giorno.";
  if (status === 400) return "Data non valida. Controlla il formato.";
  if (status >= 500) return "Servizio NASA temporaneamente non disponibile. Riprova più tardi.";
  // fallback validazione client
  if (date > todayISO()) return "Non puoi scegliere una data futura.";
  if (date < MIN_DATE) return "Hubble è in orbita dal 1990, ma l'archivio APOD parte dal 16 giugno 1995.";
  return "Si è verificato un errore. Riprova.";
}

export default function Home() {
  const today = useMemo(() => todayISO(), []);
  const [date, setDate] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<AstroSuccess | null>(null);
  const [imgError, setImgError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const resultRef = useRef<HTMLDivElement>(null);

  // validazione live per disabilitare bottone e mostrare hint
  const validationError = useMemo(() => {
    if (!date) return null;
    if (date > today) return "La data non può essere nel futuro.";
    if (date < MIN_DATE) return "La data deve essere dal 16/06/1995 in poi (primo APOD).";
    return null;
  }, [date, today]);

  async function fetchData(targetDate: string) {
    setError(null);
    if (!targetDate) {
      setError("Seleziona una data.");
      return;
    }
    if (targetDate > today) {
      setError("La data non può essere nel futuro.");
      return;
    }
    if (targetDate < MIN_DATE) {
      setError("La data deve essere dal 16/06/1995 in poi (primo APOD).");
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
        setError("Risposta inattesa dal server. Riprova.");
      }
    } catch (err) {
      const isNotReady =
        err instanceof TypeError && String(err.message).toLowerCase().includes("fetch");
      setError(
        isNotReady
          ? "Servizio momentaneamente non disponibile. Riprova tra poco."
          : "Errore di rete. Controlla la connessione e riprova."
      );
    } finally {
      setLoading(false);
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    await fetchData(date);
  }

  // deep-link: leggi searchParams ?date= al mount
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const d = params.get("date");
      if (d && /^\d{4}-\d{2}-\d{2}$/.test(d)) {
        const todayStr = todayISO();
        if (d >= MIN_DATE && d <= todayStr) {
          setDate(d);
          fetchData(d);
        }
      }
    } catch {}
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
        showToast("Link copiato!");
      } catch {}
    } else if (navigator.clipboard) {
      try {
        await navigator.clipboard.writeText(shareUrl);
        showToast("Link copiato!");
      } catch {
        showToast("Link copiato!");
      }
    } else {
      showToast("Link copiato!");
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
          telescope image from your day. Archive since June 16, 1995.
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
                  aria-describedby="date-hint date-error"
                  className="w-full rounded-xl bg-zinc-950 border border-zinc-800 px-4 py-3 text-[15px] text-zinc-100 placeholder:text-zinc-500 outline-none focus:border-zinc-600 focus:ring-2 focus:ring-zinc-700/50 transition"
                />
                <p id="date-hint" className="mt-2 text-xs text-zinc-400">
                  Min 06/16/1995 — Max today ({formatDateIT(today)})
                </p>
              </div>

              <button
                type="submit"
                disabled={loading || !!validationError || !date}
                className="inline-flex items-center justify-center rounded-xl bg-white px-6 py-3 text-sm font-semibold text-zinc-900 shadow hover:bg-zinc-100 disabled:opacity-40 disabled:cursor-not-allowed transition shrink-0 sm:self-start sm:mt-0 min-w-[170px] h-[46px]"
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
              id="date-error"
              role="alert"
              className="mt-5 rounded-xl border border-red-900/50 bg-red-950/40 px-4 py-3 text-sm leading-5 text-red-200"
            >
              {error}
              {error.toLowerCase().includes("429") || error.toLowerCase().includes("troppe") ? (
                <p className="mt-1 text-xs text-red-300/80">
                  Suggerimento: attendi 30-60 secondi e riprova.
                </p>
              ) : null}
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

        {/* Risultato */}
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
                  placeholder="empty"
                  referrerPolicy="no-referrer"
                  onError={() => setImgError("Immagine non disponibile")}
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
                    Data esatta
                  </span>
                )}
                <span className="text-xs text-zinc-400">
                  Richiesta: {formatDateIT(data.requestedDate)} · Mostrata:{" "}
                  {formatDateIT(data.actualDate)}
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
                  Fonte: <span className="text-zinc-300">{data.source}</span>
                </span>
                <span>
                  Crediti: <span className="text-zinc-300">{data.creditedTo}</span>
                </span>
                <span>
                  Data immagine: <span className="text-zinc-300">{data.actualDate}</span>
                </span>
              </div>

              <div className="pt-3 flex flex-wrap gap-3">
                <a
                  href={data.imageUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center justify-center rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-zinc-900 hover:bg-zinc-100 transition"
                >
                  Apri HD
                </a>
                <button
                  type="button"
                  onClick={handleShare}
                  className="inline-flex items-center justify-center rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-2.5 text-sm font-medium text-zinc-200 hover:bg-zinc-800 transition"
                >
                  Condividi
                </button>
              </div>

              {data.isFallback && (
                <p className="text-xs leading-5 text-zinc-400 bg-zinc-950 rounded-xl px-3 py-2 border border-zinc-800">
                  Per questa data non c&apos;era un&apos;immagine APOD disponibile
                  (video o dato mancante). Ti mostriamo la foto Hubble/JWST più vicina
                  dell&apos;anno {data.actualDate.slice(0, 4)} dall&apos;archivio NASA Image Library.
                </p>
              )}
            </div>
          </div>
        )}

        {/* Footer info */}
        <p className="mt-8 text-center text-xs leading-5 text-zinc-500">
          Dati da NASA APOD &amp; NASA Image Library. Nessuna chiave API esposta al client.
          <br />
          Hubble in orbita dal 1990 · APOD dal 16/06/1995 · JWST dal 2022.
        </p>
      </main>

      {/* Toast */}
      <div aria-live="polite" aria-atomic="true" className="sr-only">
        {toast ? toast : null}
      </div>
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
