/**
 * Fetch with timeout using AbortSignal.timeout.
 * An optional upstream signal is merged via AbortSignal.any when available,
 * falling back to manual AbortController composition on older runtimes.
 */

export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = 8000
): Promise<Response> {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);

  if (typeof AbortSignal.any === "function") {
    const signals = init.signal ? [init.signal, timeoutSignal] : [timeoutSignal];
    return fetch(input, { ...init, signal: AbortSignal.any(signals) });
  }

  // Fallback for runtimes without AbortSignal.any: manual controller.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const onTimeoutAbort = () => controller.abort(timeoutSignal.reason);
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
