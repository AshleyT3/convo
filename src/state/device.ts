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
