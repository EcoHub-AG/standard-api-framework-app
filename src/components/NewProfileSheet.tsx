import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { UserPlus } from "lucide-react";
import { useApp } from "../store";
import type { Role } from "../types";

const ENVIRONMENTS = ["Production", "IAT", "Staging", "Test", "Development"];

export default function NewProfileSheet() {
  const { newProfileOpen, setNewProfileOpen, createProfile, setView, toast } = useApp();
  const [name, setName] = useState("");
  const [role, setRole] = useState<Role>("insurer");
  const [environment, setEnvironment] = useState("IAT");

  function close() {
    setNewProfileOpen(false);
    setName("");
    setRole("insurer");
    setEnvironment("IAT");
  }
  function create() {
    const finalName = name.trim() || (role === "insurer" ? "New Insurer" : "New Broker");
    createProfile({ name: finalName, role, environment });
    toast(`Profile "${finalName}" created`);
    close();
    setView("config");
  }

  return (
    <AnimatePresence>
      {newProfileOpen && (
        <>
          <motion.div className="sheet-scrim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={close} />
          <motion.div
            className="sheet"
            role="dialog"
            aria-modal="true"
            initial={{ x: "-50%", y: "-104%" }}
            animate={{ x: "-50%", y: "0%" }}
            exit={{ x: "-50%", y: "-104%" }}
            transition={{ type: "spring", stiffness: 220, damping: 26 }}
          >
            <div className="sheet-head">
              <span className="sh-icon"><UserPlus size={16} /></span>
              <div>
                <h2>New profile</h2>
                <div className="sh-sub">Each profile is an independent identity with its own keys</div>
              </div>
            </div>
            <div className="sheet-body">
              <div className="frow">
                <label className="fl">Profile name <span className="req">*</span></label>
                <input className="input" autoFocus placeholder="e.g. SAF Insurer — IAT" value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="frow two">
                <div>
                  <label className="fl">Role</label>
                  <div className="selectw">
                    <select value={role} onChange={(e) => setRole(e.target.value as Role)}>
                      <option value="insurer">Insurer</option>
                      <option value="broker">Broker</option>
                    </select>
                  </div>
                </div>
                <div>
                  <label className="fl">Environment</label>
                  <div className="selectw">
                    <select value={environment} onChange={(e) => setEnvironment(e.target.value)}>
                      {ENVIRONMENTS.map((e) => <option key={e}>{e}</option>)}
                    </select>
                  </div>
                </div>
              </div>
              <div className="hint">You'll add credentials and generate keys for this profile next, in Configuration.</div>
            </div>
            <div className="sheet-foot">
              <span className="sf-note"><UserPlus size={13} />Stored locally, switchable anytime</span>
              <button className="btn-text" onClick={close}>Cancel</button>
              <button className="btn-primary" onClick={create}>Create profile</button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
