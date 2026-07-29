import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Profile, Role } from "./types";
import { load, save } from "./lib/storage";

export type View = "send" | "inbox" | "outbox" | "config";

const initials = (name: string) =>
  name.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase() || "SAF";

function defaultProfile(): Profile {
  return {
    id: "p-" + Math.random().toString(36).slice(2, 9),
    name: "SAF Insurer",
    role: "insurer",
    avatar: "SI",
    connected: false,
    credentials: { environment: "IAT", idp: "", license: "", password: "", iak: "", orgId: "" },
    techUser: null,
    encKeys: [],
    sigKeys: [],
  };
}

type Store = {
  profiles: Profile[];
  active: Profile;
  activeId: string;
  switchProfile: (id: string) => void;
  createProfile: (input: { name: string; role: Role; environment: string }) => string;
  updateActive: (patch: Partial<Profile>) => void;
  updateProfile: (id: string, patch: Partial<Profile>) => void;
  deleteProfile: (id: string) => void;
  // compatibility surface (derived from the active profile)
  role: Role;
  title: string;
  configured: boolean;
  setRole: (r: Role) => void;
  setTitle: (t: string) => void;
  setConfigured: (b: boolean) => void;
  view: View;
  setView: (v: View) => void;
  toast: (msg: string) => void;
  toastMsg: string | null;
  busTick: number;
  bumpBus: () => void;
  newProfileOpen: boolean;
  setNewProfileOpen: (b: boolean) => void;
  // ids of inbox messages received live during THIS app session (never persisted —
  // resets on restart), used to badge "new" vs. history loaded from the vault.
  sessionInboxIds: Set<string>;
  markReceivedThisSession: (id: string) => void;
};

const Ctx = createContext<Store | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [profiles, setProfiles] = useState<Profile[]>(() => {
    const stored = load<Profile[]>("profiles", []);
    return stored.length ? stored : [defaultProfile()];
  });
  const [activeId, setActiveId] = useState<string>(() => load<string>("activeId", "") || "");
  const [view, setView] = useState<View>("inbox");
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [busTick, setBusTick] = useState(0);
  const [newProfileOpen, setNewProfileOpen] = useState(false);
  const [sessionInboxIds, setSessionInboxIds] = useState<Set<string>>(new Set());

  // ensure activeId points at an existing profile
  const resolvedActiveId = useMemo(
    () => (profiles.find((p) => p.id === activeId) ? activeId : profiles[0].id),
    [profiles, activeId]
  );
  const active = useMemo(() => profiles.find((p) => p.id === resolvedActiveId)!, [profiles, resolvedActiveId]);

  // persist
  useEffect(() => save("profiles", profiles), [profiles]);
  useEffect(() => save("activeId", resolvedActiveId), [resolvedActiveId]);
  useEffect(() => {
    document.body.setAttribute("data-role", active.role);
  }, [active.role]);

  function updateProfile(id: string, patch: Partial<Profile>) {
    setProfiles((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  }
  function updateActive(patch: Partial<Profile>) {
    updateProfile(resolvedActiveId, patch);
  }
  function switchProfile(id: string) {
    setActiveId(id);
  }
  function createProfile(input: { name: string; role: Role; environment: string }) {
    const p: Profile = {
      ...defaultProfile(),
      id: "p-" + Math.random().toString(36).slice(2, 9),
      name: input.name,
      role: input.role,
      avatar: initials(input.name),
      credentials: { ...defaultProfile().credentials, environment: input.environment },
    };
    setProfiles((prev) => [...prev, p]);
    setActiveId(p.id);
    return p.id;
  }
  function deleteProfile(id: string) {
    setProfiles((prev) => (prev.length > 1 ? prev.filter((p) => p.id !== id) : prev));
  }

  function setRole(r: Role) {
    updateActive({ role: r });
  }
  function setTitle(t: string) {
    const name = t.trim() || active.name;
    updateActive({ name, avatar: initials(name) });
  }
  function setConfigured(b: boolean) {
    updateActive({ connected: b });
  }
  function toast(msg: string) {
    setToastMsg(msg);
    window.clearTimeout((toast as any)._t);
    (toast as any)._t = window.setTimeout(() => setToastMsg(null), 2300);
  }
  function markReceivedThisSession(id: string) {
    setSessionInboxIds((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));
  }

  const value: Store = {
    profiles,
    active,
    activeId: resolvedActiveId,
    switchProfile,
    createProfile,
    updateActive,
    updateProfile,
    deleteProfile,
    role: active.role,
    title: active.name,
    configured: active.connected,
    setRole,
    setTitle,
    setConfigured,
    view,
    setView,
    toast,
    toastMsg,
    busTick,
    bumpBus: () => setBusTick((t) => t + 1),
    newProfileOpen,
    setNewProfileOpen,
    sessionInboxIds,
    markReceivedThisSession,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useApp must be used within StoreProvider");
  return v;
}
