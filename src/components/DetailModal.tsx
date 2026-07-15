import { AnimatePresence, motion } from "framer-motion";
import { X, CheckCircle2, AlertTriangle } from "lucide-react";
import { copyText } from "../lib/format";

export type Detail = { title: string; status: number; ok: boolean; body: string; url?: string } | null;

export default function DetailModal({ detail, onClose }: { detail: Detail; onClose: () => void }) {
  return (
    <AnimatePresence>
      {detail && (
        <>
          <motion.div className="sheet-scrim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
          <motion.div
            className="modal-card"
            role="dialog"
            aria-modal="true"
            initial={{ opacity: 0, scale: 0.96, x: "-50%", y: "-50%" }}
            animate={{ opacity: 1, scale: 1, x: "-50%", y: "-50%" }}
            exit={{ opacity: 0, scale: 0.96, x: "-50%", y: "-50%" }}
            transition={{ duration: 0.16 }}
          >
            <div className="modal-head">
              <span className="card-icon" style={{ background: detail.ok ? "var(--ok-tint)" : "var(--err-tint)", color: detail.ok ? "var(--ok)" : "var(--err)" }}>
                {detail.ok ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="card-title">{detail.title}</div>
                <div className="card-desc">
                  HTTP {detail.status || "—"} · {detail.ok ? "Success" : "Failed"}{detail.url ? ` · ${detail.url}` : ""}
                </div>
              </div>
              <button className="banner-x" onClick={onClose} title="Close"><X size={16} /></button>
            </div>
            <div className="modal-body">
              <div className="ciph-head"><span className="lbl">Response body</span>
                <button className="btn-copy" onClick={() => copyText(detail.body)}>Copy</button>
              </div>
              <pre className="code-block" style={{ maxHeight: 320 }}>{detail.body || "(empty response body)"}</pre>
            </div>
            <div className="modal-foot">
              <button className="btn-primary" onClick={onClose}>Close</button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
