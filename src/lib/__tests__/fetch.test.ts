import { describe, it, expect, vi, afterEach } from "vitest";
import { fetchWithTimeout } from "@/lib/fetch";

/** Install a fake `fetch` that rejects with an AbortError when its signal aborts. */
function fakeFetchThatAborts(): ReturnType<typeof vi.fn> {
  return vi.fn(
    (_url: string, init: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        if (init.signal?.aborted) {
          reject(new DOMException("aborted", "AbortError"));
          return;
        }
        init.signal?.addEventListener("abort", () => {
          reject(new DOMException("aborted", "AbortError"));
        });
      })
  );
}

describe("fetchWithTimeout", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("resolves when fetch is fast", async () => {
    const res = new Response("ok");
    vi.stubGlobal("fetch", vi.fn(async () => res));
    const out = await fetchWithTimeout("https://example.com", {}, 1000);
    expect(out).toBe(res);
  });

  it("aborts when fetch exceeds the timeout", async () => {
    vi.stubGlobal("fetch", fakeFetchThatAborts());
    await expect(fetchWithTimeout("https://example.com", {}, 50)).rejects.toThrow();
  });

  it("propagates an already-aborted upstream signal", async () => {
    const controller = new AbortController();
    controller.abort(new Error("stop"));
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        if (init.signal?.aborted) throw new DOMException("aborted", "AbortError");
        return new Response("x");
      })
    );
    await expect(
      fetchWithTimeout("https://example.com", { signal: controller.signal }, 1000)
    ).rejects.toThrow();
  });
});
