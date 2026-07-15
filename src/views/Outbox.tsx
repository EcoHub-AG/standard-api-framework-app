import { useMemo } from "react";
import { SendHorizontal } from "lucide-react";
import { useApp } from "../store";
import { StatusChip } from "../components/Chip";
import { outboxFor } from "../lib/bus";

export default function Outbox() {
  const { active, setView, busTick } = useApp();
  const items = useMemo(() => outboxFor(active.id), [active.id, busTick]);

  return (
    <div className="view">
      <div className="chead">
        <div><h1>Outbox</h1><div className="sub">Events {active.name} has published, with delivery status</div></div>
        <div className="chead-spacer" />
        <button className="btn-primary" onClick={() => setView("send")}><SendHorizontal size={14} /> New event</button>
      </div>

      <div className="splitter">
        <div className="list full">
          {items.length === 0 ? (
            <div className="empty-mailbox">
              <SendHorizontal strokeWidth={1.4} />
              <div className="em-title">Nothing sent yet</div>
              <div className="em-sub">Publish your first event from Send event.</div>
            </div>
          ) : items.map((m) => (
            <div key={m.id} className="row">
              <span className="r-unreaddot" />
              <div className="r-body">
                <div className="r-top"><span className="r-from">To {m.toName}</span><span className="r-time">{m.time}</span></div>
                <div className="r-subject">{m.subject || "(no subject)"}</div>
                <div className="r-meta"><span className="topic-tag">{m.topic}</span><StatusChip status={m.status} /></div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
