import { useEffect, useState } from "react";

const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

type UpdateHandle = Awaited<ReturnType<typeof import("@tauri-apps/plugin-updater").check>>;

type State = {
  update: UpdateHandle | null;
  checking: boolean;
  installing: boolean;
};

let state: State = { update: null, checking: false, installing: false };
const listeners = new Set<() => void>();

function setState(patch: Partial<State>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

/** Checks for an update. Returns true if one was found. No-op outside Tauri or while already checking. */
export async function checkForUpdate(): Promise<boolean> {
  if (!isTauri || state.checking) return false;
  setState({ checking: true });
  try {
    const { check } = await import("@tauri-apps/plugin-updater");
    const u = await check();
    setState({ update: u ?? null, checking: false });
    return !!u;
  } catch {
    setState({ checking: false });
    return false;
  }
}

export async function installUpdate(): Promise<void> {
  if (!state.update) return;
  setState({ installing: true });
  try {
    await state.update.downloadAndInstall();
    const { relaunch } = await import("@tauri-apps/plugin-process");
    await relaunch();
  } catch {
    setState({ installing: false });
  }
}

export function dismissUpdate() {
  setState({ update: null });
}

export function useUpdater() {
  const [, force] = useState(0);
  useEffect(() => {
    const l = () => force((n) => n + 1);
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, []);
  return state;
}
