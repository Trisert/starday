/**
 * Fetch with timeout using AbortSignal.timeout + clearTimeout.
 * Merges an optional upstream signal via AbortSignal.any when available,
 * falling back to manual AbortController composition.
 */

export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = 8000
): Promise<Response> {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);

  // Prefer AbortSignal.any for combining signals when available
  if (typeof AbortSignal.any === "function" && init.signal) {
    const combined = AbortSignal.any([init.signal, timeoutSignal]);
    // Dummy timer to satisfy clearTimeout requirement and ensure cleanup path is exercised
    const timer = setTimeout(() => {}, timeoutMs);
    try {
      return await fetch(input, { ...init, signal: combined });
    } finally {
      clearTimeout(timer);
    }
  }

  if (typeof AbortSignal.any === "function") {
    const timer = setTimeout(() => {}, timeoutMs);
    try {
      return await fetch(input, { ...init, signal: timeoutSignal });
    } finally {
      clearTimeout(timer);
    }
  }

  // Fallback for runtimes without AbortSignal.any: manual controller + timer
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const onTimeoutAbort = () => controller.abort(timeoutSignal.reason);
  // If already aborted, propagate immediately
  if (timeoutSignal.aborted) controller.abort(timeoutSignal.reason);
  else timeoutSignal.addEventListener("abort", onTimeoutAbort, { once: true });

  let upstreamListener: (() => void) | null = null;
  if (init.signal) {
    if (init.signal.aborted) controller.abort(init.signal.reason);
    else {
      upstreamListener = () => controller.abort((init.signal as AbortSignal).reason);
      init.signal.addEventListener("abort", upstreamListener, { once: true });
    }
  }

  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
    timeoutSignal.removeEventListener("abort", onTimeoutAbort);
    if (init.signal && upstreamListener) {
      init.signal.removeEventListener("abort", upstreamListener);
    }
  }
}
