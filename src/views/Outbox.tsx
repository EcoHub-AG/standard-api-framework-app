import { useMemo, useState } from "react";
import { SendHorizontal, Search, Copy } from "lucide-react";
import { useApp } from "../store";
import { StatusChip } from "../components/Chip";
import { outboxFor } from "../lib/bus";
import JsonView from "../components/JsonView";
import { toJSON, copyText } from "../lib/format";

export default function Outbox() {
  const { active, setView, busTick, toast } = useApp();
  const items = useMemo(() => outboxFor(active.id), [active.id, busTick]);

  const [q, setQ] = useState("");
  const [selId, setSelId] = useState<string | null>(null);

  // Search by subject and processId (the two identifiers used to trace an event
  // with a counterparty), plus recipient/topic for convenience.
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return items;
    return items.filter((m) =>
      [m.subject, m.processId, m.toName, m.toIdp, m.topic]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(s)
    );
  }, [items, q]);

  const sel = filtered.find((m) => m.id === selId) ?? filtered[0] ?? null;
  const rawText = sel?.rawEvent ? toJSON(sel.rawEvent) : "";

  return (
    <div className="view">
      <div className="chead">
        <div><h1>Outbox</h1><div className="sub">Events {active.name} has published, with delivery status</div></div>
        <div className="chead-spacer" />
        <div className="search" style={{ width: 260 }}><Search size={14} /><input placeholder="Search subject or process ID" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <button className="btn-primary" onClick={() => setView("send")}><SendHorizontal size={14} /> New event</button>
      </div>

      {items.length === 0 ? (
        <div className="empty-mailbox" style={{ flex: 1 }}>
          <SendHorizontal strokeWidth={1.4} />
          <div className="em-title">Nothing sent yet</div>
          <div className="em-sub">Publish your first event from Send event.</div>
        </div>
      ) : filtered.length === 0 ? (
        <div className="empty-mailbox" style={{ flex: 1 }}>
          <Search strokeWidth={1.4} />
          <div className="em-title">No matches</div>
          <div className="em-sub">No sent event matches "{q}".</div>
        </div>
      ) : (
        <div className="splitter">
          <div className="list" style={{ width: 430 }}>
            {filtered.map((m) => (
              <div key={m.id} className={"row" + (sel?.id === m.id ? " sel" : "")} onClick={() => setSelId(m.id)}>
                <span className="r-unreaddot" />
                <div className="r-body">
                  <div className="r-top"><span className="r-from">To {m.toName}</span><span className="r-time">{m.time}</span></div>
                  <div className="r-subject">{m.subject || "(no subject)"}</div>
                  <div className="r-meta">
                    <span className="topic-tag">{m.topic}</span>
                    {m.processId && <span className="chip chip-pending">{m.processId}</span>}
                    <StatusChip status={m.status} />
                  </div>
                </div>
              </div>
            ))}
          </div>

          {!sel ? (
            <div className="detail-empty">
              <SendHorizontal strokeWidth={1.4} />
              <div className="de-title">No event selected</div>
              <div className="de-sub">Pick a sent event to inspect its metadata and payload.</div>
            </div>
          ) : (
            <div className="detail">
              <div className="pipeline single">
                <div className="pane">
                  <div className="pane-head">
                    <span className="pane-step">1</span>
                    <div className="pane-titles">
                      <div className="pane-title">Sent event</div>
                      <div className="pane-sub">CloudEvents envelope produced to the in-topic</div>
                    </div>
                  </div>
                  <div className="pane-body">
                    <div className="enc-meta">
                      <span className="k">To</span><span className="v">{sel.toName} · {sel.toIdp}</span>
                      <span className="k">Subject</span><span className="v">{sel.subject || "—"}</span>
                      <span className="k">Process ID</span><span className="v">{sel.processId || "—"}</span>
                      <span className="k">Topic</span><span className="v">{sel.topic}</span>
                      <span className="k">Standard</span><span className="v">{sel.standardNs || "—"}</span>
                      <span className="k">Sent</span><span className="v">{sel.time}</span>
                    </div>
                    <div className="ciph-head">
                      <span className="lbl">event JSON</span>
                      <span className="ciph-head-right">
                        {!sel.rawEvent && <span className="chip chip-pending">payload not recorded</span>}
                        {sel.rawEvent && <button className="btn-copy" onClick={() => { copyText(rawText); toast("Copied"); }}><Copy size={12} /> Copy</button>}
                      </span>
                    </div>
                    {sel.rawEvent ? (
                      <JsonView data={sel.rawEvent} className="code-block-bounded" />
                    ) : (
                      <div className="pane-empty">
                        <SendHorizontal strokeWidth={1.5} />
                        <div className="t">No stored payload</div>
                        <div className="s">This event was sent before the payload was recorded in the Outbox. New sends will show the full event here.</div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
