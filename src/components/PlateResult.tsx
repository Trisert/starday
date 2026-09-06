"use client";

import { useState } from "react";
import Image from "next/image";
import type { AstroSuccess } from "@/lib/astro-types";
import { formatDisplayDate } from "@/lib/astro-types";

/**
 * Hairline-styled meta row used inside the dossier block.
 * Renders a small uppercase label followed by its value on the same line.
 */
export function MetaLine({ label, value }: { label: string; value: string }) {
  return (
    <span>
      {label}{" "}
      <span className="text-[#d0d6e0]">{value}</span>
    </span>
  );
}

export interface PlateResultProps {
  data: AstroSuccess;
  shareUrl: string;
  onShare: () => void;
}

/**
 * Archival dossier plate — the result card for a resolved NASA photo.
 *
 * Layout:
 * - figure (black background, Next/Image with object-contain, or alert box on error)
 * - dossier block: mono badge (EXACT DATE / CLOSEST IMAGE — YYYY),
 *   title, caption, meta grid (SOURCE / IMAGE DATE / REQUESTED / SHOWN / CREDITS),
 *   actions (Open HD ↗ + Share), fallback note when isFallback.
 *
 * Visual language: zero gradients, zero glass — hairline borders only.
 * Single brass accent (#c79a3b) on the Open HD action.
 */
export default function PlateResult({ data, shareUrl, onShare }: PlateResultProps) {
  const [imgError, setImgError] = useState<string | null>(null);

  return (
    <figure
      className="fade-soft mt-6 overflow-hidden rounded-[2px] border border-white/10 bg-[#0f1011] focus:outline-none"
      aria-live="polite"
    >
      {/* Image plate */}
      <div className="relative h-[280px] w-full overflow-hidden bg-black sm:h-[420px]">
        {imgError ? (
          <div
            role="alert"
            className="flex min-h-[280px] w-full items-center justify-center p-6 text-sm text-red-300 sm:min-h-[420px]"
          >
            {imgError}
          </div>
        ) : (
          <Image
            src={data.imageUrl}
            alt={data.title}
            fill
            className="object-contain"
            sizes="(max-width:768px) 100vw,768px"
            priority
            referrerPolicy="no-referrer"
            onError={() => setImgError("Image unavailable")}
          />
        )}
      </div>

      {/* Dossier */}
      <figcaption className="space-y-4 p-5 sm:p-7">
        {/* Badge row */}
        <div className="flex flex-wrap items-center gap-3 border-b border-white/10 pb-4">
          {data.isFallback ? (
            <span className="inline-flex items-center border border-amber-400/30 bg-amber-400/10 px-3 py-1 font-mono text-[11px] font-medium tracking-[0.15em] text-amber-300 uppercase">
              ✦ CLOSEST IMAGE — {data.actualDate.slice(0, 4)}
            </span>
          ) : (
            <span className="inline-flex items-center border border-emerald-400/30 bg-emerald-400/10 px-3 py-1 font-mono text-[11px] font-medium tracking-[0.15em] text-emerald-300 uppercase">
              ● EXACT DATE
            </span>
          )}
          <span className="font-mono text-[11px] tracking-[0.15em] text-[#62666d] uppercase">
            Plate {data.actualDate} · Mission {data.isFallback ? "IMAGE LIBRARY" : "APOD"}
          </span>
        </div>

        {/* Title + caption */}
        <div className="space-y-2">
          <h2 className="display-tight text-xl leading-tight font-semibold text-[#f7f8f8] sm:text-2xl">
            {data.title}
          </h2>
          <p className="text-sm leading-6 text-[#d0d6e0] sm:text-[15px] sm:leading-7">
            {data.caption}
          </p>
        </div>

        {/* Meta grid */}
        <dl className="grid grid-cols-1 gap-2 border-t border-white/10 pt-4 font-mono text-[11px] tracking-[0.15em] text-[#62666d] uppercase sm:grid-cols-2">
          <MetaLine label="Source" value={data.source} />
          <MetaLine label="Image Date" value={data.actualDate} />
          <MetaLine label="Requested" value={formatDisplayDate(data.requestedDate)} />
          <MetaLine label="Shown" value={formatDisplayDate(data.actualDate)} />
          <span className="sm:col-span-2">
            <MetaLine label="Credits" value={data.creditedTo} />
          </span>
        </dl>

        {/* Actions */}
        <div className="flex flex-wrap gap-3 border-t border-white/10 pt-4">
          <a
            href={data.imageUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center border border-[#c79a3b]/60 bg-[#c79a3b] px-4 py-2.5 text-sm font-semibold text-[#08090a] transition hover:bg-[#d8a84a]"
          >
            Open HD ↗
          </a>
          <button
            type="button"
            onClick={onShare}
            data-share-url={shareUrl}
            className="inline-flex items-center justify-center border border-white/15 bg-transparent px-4 py-2.5 text-sm font-medium text-zinc-200 transition hover:bg-white/5"
          >
            Share
          </button>
        </div>

        {/* Fallback note */}
        {data.isFallback && (
          <p className="border border-white/10 bg-black/40 px-3 py-2 text-xs leading-5 text-[#8a8f98]">
            No APOD image was available for this date (video or missing data).
            Showing the closest Hubble/JWST photo from {data.actualDate.slice(0, 4)}
            in the NASA Image Library archive.
          </p>
        )}
      </figcaption>
    </figure>
  );
}