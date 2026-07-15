import { useMemo, useState } from "react";
import { Search, Inbox as InboxIcon, Lock, ArrowRight } from "lucide-react";
import { useApp } from "../store";
import { inboxFor } from "../lib/bus";
import { toJSON } from "../lib/format";

export default function Inbox() {
  const { active, busTick, setView, configured } = useApp();
  const idp = active.credentials.idp || active.id;
  const items = useMemo(() => inboxFor(idp), [idp, busTick]);
  const [selId, setSelId] = useState<string | null>(null);
  const [q, setQ] = useState("");

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? items.filter((m) => (m.fromName + m.subject + m.topic).toLowerCase().includes(s)) : items;
  }, [items, q]);
  const sel = items.find((m) => m.id === selId) || null;

  return (
    <div className="view">
      <div className="chead">
        <div><h1>Inbox</h1><div className="sub">Encrypted events received by {active.name}</div></div>
        <div className="chead-spacer" />
        {configured && <div className="live-ind"><span className="ld" />Listening</div>}
        <div className="search"><Search size={14} /><input placeholder="Search messages" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      </div>

      <div className="splitter">
        <div className="list">
          {filtered.length === 0 ? (
            <div className="empty-mailbox"><InboxIcon strokeWidth={1.4} /><div className="em-title">Inbox empty</div><div className="em-sub">Events sent to this profile land here.</div></div>
          ) : filtered.map((m) => (
            <div key={m.id} className={"row" + (selId === m.id ? " sel" : "")} onClick={() => setSelId(m.id)}>
              <span className="r-unreaddot" />
              <div className="r-body">
                <div className="r-top"><span className="r-from">{m.fromName}</span><span className="r-time">{m.time}</span></div>
                <div className="r-subject">{m.subject}</div>
                <div className="r-meta"><span className="topic-tag">{m.topic}</span><span className="chip chip-pending"><Lock size={10} />Encrypted</span></div>
              </div>
            </div>
          ))}
        </div>

        {!sel ? (
          <div className="detail-empty">
            <InboxIcon strokeWidth={1.4} />
            <div className="de-title">No message selected</div>
            <div className="de-sub">Pick an event to inspect its envelope, then decrypt it in Receive event.</div>
          </div>
        ) : (
          <div className="detail">
            <h2 className="d-subject">{sel.subject}</h2>
            <div className="d-grid">
              <span className="d-k">From</span><span className="d-v">{sel.fromName}</span>
              <span className="d-k">Topic</span><span className="d-v mono">{sel.topic}</span>
              <span className="d-k">Standard</span><span className="d-v mono">{sel.standardNs}</span>
              <span className="d-k">Received</span><span className="d-v">Today, {sel.time}</span>
            </div>
            <div className="d-divider" />
            <div className="payload-head"><span className="lbl">Encrypted envelope</span><span className="topic-tag">AES-GCM · RSA-OAEP</span></div>
            <div className="payload">{toJSON(sel.envelope)}</div>
            <button className="btn-primary" style={{ marginTop: 14 }} onClick={() => setView("receive")}>
              Decrypt in Receive event <ArrowRight size={14} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
