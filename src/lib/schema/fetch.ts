// Thin GET wrapper for live schema fetches (raw.githubusercontent.com).
// Tauri: uses @tauri-apps/plugin-http (real network stack, bypasses the
// EcoHub-only mTLS command). Browser dev: window.fetch fallback.
import { isTauri } from "../ecohub";

export type FetchResult = { ok: boolean; status: number; text: string };

export async function getText(url: string): Promise<FetchResult> {
  try {
    if (isTauri) {
      const { fetch: tauriFetch } = await import("@tauri-apps/plugin-http");
      const res = await tauriFetch(url, { method: "GET" });
      return { ok: res.ok, status: res.status, text: await res.text() };
    }
    const res = await window.fetch(url);
    return { ok: res.ok, status: res.status, text: await res.text() };
  } catch (e) {
    return { ok: false, status: 0, text: String((e as Error).message ?? e) };
  }
}
