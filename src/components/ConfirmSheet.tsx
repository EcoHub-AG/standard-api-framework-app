import { AnimatePresence, motion } from "framer-motion";
import { TriangleAlert } from "lucide-react";
import { useApp } from "../store";

export default function ConfirmSheet() {
  const { confirmRequest, resolveConfirm } = useApp();

  return (
    <AnimatePresence>
      {confirmRequest && (
        <>
          <motion.div className="sheet-scrim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => resolveConfirm(false)} />
          <motion.div
            className="sheet"
            role="alertdialog"
            aria-modal="true"
            initial={{ x: "-50%", y: "-104%" }}
            animate={{ x: "-50%", y: "0%" }}
            exit={{ x: "-50%", y: "-104%" }}
            transition={{ type: "spring", stiffness: 220, damping: 26 }}
          >
            <div className="sheet-head">
              <span className="sh-icon" style={{ background: "var(--err)" }}><TriangleAlert size={16} /></span>
              <div>
                <h2>Are you sure?</h2>
                <div className="sh-sub">{confirmRequest.message}</div>
              </div>
            </div>
            <div className="sheet-foot">
              <span className="sf-note" />
              <button className="btn-text" onClick={() => resolveConfirm(false)}>Cancel</button>
              <button className="btn-primary" style={{ background: "var(--err)" }} onClick={() => resolveConfirm(true)}>Delete</button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
