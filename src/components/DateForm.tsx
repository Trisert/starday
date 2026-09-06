"use client";

/**
 * Archival Dossier — DateForm
 *
 * Compact form-requisition column. Hairline borders, mono uppercase hint,
 * ottone (#c79a3b) submit focus ring. No glassmorphism, no gradients.
 *
 * Contract (frozen):
 *  - label: "Your birthdate"
 *  - input id="birthdate", type=date, min/max/required
 *  - aria-describedby toggles to "date-hint date-error" when validationError is set
 *  - hint: "Min 10/04/1957 — Max today ({date})" — rendered in mono
 *  - submit: "Show my photo" / "Loading..." — disabled on loading, validationError, or empty date
 *  - error: only when validationError && date && !loading, role=alert
 *  - onChange must reset caller-side errors (parent owns the side-effect)
 */

import * as React from "react";
import { formatDisplayDate } from "@/lib/astro-types";

export interface DateFormProps {
  date: string;
  today: string;
  minDate: string;
  validationError: string | null;
  loading: boolean;
  onSubmit: (e: React.FormEvent) => void;
  onDateChange: (v: string) => void;
}

export function DateForm({
  date,
  today,
  minDate,
  validationError,
  loading,
  onSubmit,
  onDateChange,
}: DateFormProps) {
  const describedBy = validationError ? "date-hint date-error" : "date-hint";
  const disabled = loading || !!validationError || !date;

  return (
    <form
      onSubmit={onSubmit}
      className="df-form flex flex-col gap-4"
      noValidate
    >
      <label
        htmlFor="birthdate"
        className="df-label block text-[11px] font-medium tracking-[0.18em] uppercase text-zinc-300"
      >
        Your birthdate
      </label>

      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="flex-1">
          <input
            id="birthdate"
            type="date"
            value={date}
            onChange={(e) => onDateChange(e.target.value)}
            min={minDate}
            max={today}
            required
            aria-describedby={describedBy}
            className="df-input h-[46px] w-full rounded-none border border-white/15 bg-transparent px-3 text-[15px] text-zinc-100 outline-none transition placeholder:text-zinc-500 focus:border-[#c79a3b] focus:ring-1 focus:ring-[#c79a3b]/60"
          />
          <p
            id="date-hint"
            className="df-hint mt-2 font-mono text-[11px] tracking-[0.12em] uppercase text-zinc-500"
          >
            Min 10/04/1957 — Max today ({formatDisplayDate(today)})
          </p>
        </div>

        <button
          type="submit"
          disabled={disabled}
          className="df-submit inline-flex h-[46px] min-w-[170px] shrink-0 items-center justify-center border border-[#c79a3b] bg-transparent px-6 text-[11px] font-semibold tracking-[0.18em] uppercase text-[#c79a3b] transition-colors hover:bg-[#c79a3b]/10 focus-visible:border-[#c79a3b] focus-visible:ring-2 focus-visible:ring-[#c79a3b]/40 disabled:cursor-not-allowed disabled:opacity-40 sm:self-start"
        >
          {loading ? (
            <span className="inline-flex items-center gap-2">
              <span className="df-spinner h-4 w-4 animate-spin rounded-full border-2 border-[#c79a3b]/30 border-t-[#c79a3b]" />
              Loading...
            </span>
          ) : (
            "Show my photo"
          )}
        </button>
      </div>

      {validationError && date && !loading && (
        <p
          id="date-error"
          role="alert"
          className="df-error text-[12px] font-medium tracking-[0.06em] text-amber-300"
        >
          {validationError}
        </p>
      )}
    </form>
  );
}

export default DateForm;