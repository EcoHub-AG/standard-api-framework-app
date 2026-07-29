import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Send, Inbox as InboxIcon, SendHorizontal, Settings, ChevronsUpDown, Plus } from "lucide-react";
import { useApp, type View } from "../store";
import { outboxFor } from "../lib/bus";
import { inboxFor } from "../lib/inboxStore";

const NAV: { group: string; items: { view: View; label: string; icon: any }[] }[] = [
  {
    group: "Data Exchange",
    items: [
      { view: "send", label: "Send event", icon: Send },
      { view: "inbox", label: "Inbox", icon: InboxIcon },
      { view: "outbox", label: "Outbox", icon: SendHorizontal },
    ],
  },
  { group: "Setup", items: [{ view: "config", label: "Configuration", icon: Settings }] },
];

export default function Sidebar() {
  const { view, setView, active, profiles, switchProfile, configured, setNewProfileOpen, busTick, sessionInboxIds } = useApp();
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const close = () => setMenuOpen(false);
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, []);

  const inboxCount = inboxFor(active.credentials.idp || active.id).length;
  const outboxCount = outboxFor(active.id).length;
  void busTick; // recompute outbox count when the bus changes
  void sessionInboxIds; // recompute inbox count whenever a live message is persisted

  function badgeFor(v: View): number | string | null {
    if (v === "inbox") return inboxCount || null;
    if (v === "outbox") return outboxCount || null;
    if (v === "config") return configured ? null : "!";
    return null;
  }

  return (
    <aside className="sidebar">
      <div className="side-scroll">
        {NAV.map((g) => (
          <div key={g.group}>
            <div className="side-group">{g.group}</div>
            {g.items.map((it) => {
              const Icon = it.icon;
              const badge = badgeFor(it.view);
              const warn = it.view === "config" && !configured;
              return (
                <button key={it.view} className={"nav" + (view === it.view ? " active" : "")} onClick={() => setView(it.view)}>
                  <span className="nav-icon"><Icon size={16} strokeWidth={1.7} /></span>
                  <span className="nav-label">{it.label}</span>
                  {badge != null && (
                    <span className={"badge" + (warn ? "" : it.view === "outbox" ? " dim" : "")} style={warn ? { background: "var(--warn)" } : undefined}>
                      {badge}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </div>

      <div className="side-foot" style={{ position: "relative" }}>
        <AnimatePresence>
          {menuOpen && (
            <motion.div
              className="menu menu-up"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 6 }}
              transition={{ duration: 0.13 }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="menu-label">Profiles</div>
              {profiles.map((p) => (
                <button key={p.id} className="menu-item" onClick={() => { switchProfile(p.id); setMenuOpen(false); }}>
                  <span className="swatch" style={{ background: p.role === "insurer" ? "#0e7c7b" : "#4b45c2" }} />
                  <span className="mi-main">
                    <span>{p.name}</span>
                    <span className="mi-sub">{p.role === "insurer" ? "Insurer" : "Broker"} · {p.credentials.environment}{p.connected ? " · connected" : ""}</span>
                  </span>
                  {p.id === active.id && <span className="mi-check">✓</span>}
                </button>
              ))}
              <div className="menu-sep" />
              <button className="menu-item" onClick={() => { setMenuOpen(false); setNewProfileOpen(true); }}>
                <span className="swatch" style={{ background: "var(--ink-3)", display: "grid", placeItems: "center" }}>
                  <Plus size={9} color="#fff" />
                </span>
                <span className="mi-main"><span>New profile…</span><span className="mi-sub">Add another identity</span></span>
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        <button className="ident ident-btn" onClick={(e) => { e.stopPropagation(); setMenuOpen((o) => !o); }}>
          <div className="ident-avatar">{active.avatar}</div>
          <div className="ident-main">
            <div className="ident-name">{active.name}</div>
            <div className="ident-sub">
              <span className={"sdot " + (configured ? "on" : "off")} />
              {configured ? `Connected · ${active.credentials.environment}` : "Not connected"}
            </div>
          </div>
          <ChevronsUpDown size={14} className="ident-chev" />
        </button>
      </div>
    </aside>
  );
}
