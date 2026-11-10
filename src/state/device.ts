// What this device can do, for picking sensible first-run defaults.

/** Phones and tablets: can't run a local model server themselves. */
export function isMobileDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  const uaData = (navigator as Navigator & { userAgentData?: { mobile?: boolean } }).userAgentData;
  if (uaData?.mobile) return true;
  const ua = navigator.userAgent;
  if (/Android|iPhone|iPad|iPod|Mobile/i.test(ua)) return true;
  // iPadOS reports itself as a Mac; touch support gives it away.
  return /Macintosh/.test(ua) && navigator.maxTouchPoints > 1;
}

/**
 * True when the page itself is served from this machine or the local network
 * (dev server, a clone, self-hosting). Then probing a local model server is
 * harmless. From a public website, browsers ask the visitor for permission to
 * reach local apps, so we only do that after the visitor opts in.
 */
export function servedLocally(hostname = typeof location !== "undefined" ? location.hostname : "localhost"): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h === "::1" || h === "") return true;
  const m = h.match(/^(\d+)\.(\d+)\.\d+\.\d+$/);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return a === 127 || a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31);
}

/** Narrow screens use one page-long scroll instead of separate scroll areas (see the phones block in styles.css). */
export function phoneLayout(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(max-width: 720px)").matches;
}

export interface GpuInfo {
  webgpu: boolean;
  /** Supports 16-bit float shaders (needed by some in-browser models). */
  f16: boolean;
}

let gpuInfo: Promise<GpuInfo> | null = null;

export function getGpuInfo(): Promise<GpuInfo> {
  if (gpuInfo) return gpuInfo;
  gpuInfo = (async () => {
    const gpu = typeof navigator !== "undefined" ? (navigator as Navigator & { gpu?: { requestAdapter(): Promise<{ features: Set<string> } | null> } }).gpu : undefined;
    if (!gpu) return { webgpu: false, f16: false };
    try {
      const adapter = await gpu.requestAdapter();
      if (!adapter) return { webgpu: false, f16: false };
      return { webgpu: true, f16: adapter.features.has("shader-f16") };
    } catch {
      return { webgpu: false, f16: false };
    }
  })();
  return gpuInfo;
}
