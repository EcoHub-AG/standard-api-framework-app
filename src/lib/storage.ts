// ============================================================
// Persistence layer.
//
// Native app: encrypted SQLite vault (Rust `vault_load` / `vault_save`) — the
// whole state is AES-256-GCM sealed with a master key in the OS keychain.
// Nothing is ever written to localStorage.
//
// Browser dev preview (no Tauri): in-memory only, so the UI still works but no
// secrets are persisted to the browser.
//
// `load` / `save` stay synchronous for callers; the cache is hydrated once by
// `initStorage()` before the app mounts, and writes are debounced to the vault.
// ============================================================
const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

let cache: Record<string, unknown> = {};
let saveTimer: ReturnType<typeof setTimeout> | undefined;

async function vaultLoad(): Promise<string> {
  if (!isTauri) return "";
  const { invoke } = await import("@tauri-apps/api/core");
  return await invoke<string>("vault_load");
}
async function vaultSave(json: string): Promise<void> {
  if (!isTauri) return; // browser dev: in-memory only
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("vault_save", { json });
}

// One-time import of the pre-DB localStorage layout, then wipe those plaintext copies.
function migrateFromLocalStorage(): Record<string, unknown> | null {
  try {
    const p = localStorage.getItem("saf.profiles");
    if (!p) return null;
    const out: Record<string, unknown> = { profiles: JSON.parse(p) };
    const a = localStorage.getItem("saf.activeId");
    if (a) out.activeId = JSON.parse(a);
    const b = localStorage.getItem("saf.bus");
    if (b) out.bus = JSON.parse(b);
    ["saf.profiles", "saf.activeId", "saf.bus"].forEach((k) => localStorage.removeItem(k));
    return out;
  } catch {
    return null;
  }
}

export async function initStorage(): Promise<void> {
  let raw = "";
  try {
    raw = await vaultLoad();
  } catch (e) {
    console.error("vault load failed:", e);
  }
  if (raw) {
    try { cache = JSON.parse(raw); } catch { cache = {}; }
  }
  if (isTauri && Object.keys(cache).length === 0) {
    const migrated = migrateFromLocalStorage();
    if (migrated) { cache = migrated; persistNow(); }
  }
}

export function load<T>(key: string, fallback: T): T {
  return (cache[key] !== undefined ? (cache[key] as T) : fallback);
}

export function save<T>(key: string, value: T): void {
  cache[key] = value;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(persistNow, 150);
}

function persistNow(): void {
  vaultSave(JSON.stringify(cache)).catch((e) => console.error("vault save failed:", e));
}
