import { useState } from "react";
import { AlertTriangle, CheckCircle2, X } from "lucide-react";
import { useApp } from "../store";

export default function Banner() {
  const { configured, setView, active } = useApp();
  const [dismissed, setDismissed] = useState(false);

  if (dismissed && configured) return null;

  if (!configured) {
    return (
      <div className="banner warn">
        <span className="banner-icon"><AlertTriangle size={18} strokeWidth={1.9} /></span>
        <span className="banner-text">
          <b>Finish setup to start exchanging events.</b> Add your connection details, credentials, and signing key.
        </span>
        <button className="banner-act" onClick={() => setView("config")}>Open configuration</button>
        <button className="banner-x" title="Dismiss" onClick={() => setDismissed(true)}><X size={15} /></button>
      </div>
    );
  }

  return (
    <div className="banner ok">
      <span className="banner-icon"><CheckCircle2 size={18} strokeWidth={1.9} /></span>
      <span className="banner-text">
        <b>Connected to {active.credentials.environment}.</b> Events are signed on send and decrypted with your private key on receipt.
      </span>
      <button className="banner-x" title="Dismiss" onClick={() => setDismissed(true)}><X size={15} /></button>
    </div>
  );
}
