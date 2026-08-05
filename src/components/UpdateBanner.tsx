import { useEffect } from "react";
import { DownloadCloud, X } from "lucide-react";
import { checkForUpdate, dismissUpdate, installUpdate, useUpdater } from "../lib/updater";

export default function UpdateBanner() {
  const { update, installing, installError } = useUpdater();

  useEffect(() => {
    checkForUpdate();
  }, []);

  if (!update) return null;

  return (
    <div className={`banner ${installError ? "error" : "info"}`}>
      <span className="banner-icon"><DownloadCloud size={18} strokeWidth={1.9} /></span>
      <span className="banner-text">
        {installError ? (
          <>
            <b>Update failed:</b> {installError}
          </>
        ) : (
          <>
            <b>Update available: v{update.version}.</b> {update.body || "A new version is ready to install."}
          </>
        )}
      </span>
      <button className="banner-act" onClick={installUpdate} disabled={installing}>
        {installing ? "Installing…" : installError ? "Retry" : "Update & Restart"}
      </button>
      <button className="banner-x" title="Dismiss" onClick={dismissUpdate}><X size={15} /></button>
    </div>
  );
}
