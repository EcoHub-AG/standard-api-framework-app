import { Check, AlertCircle, X, Clock } from "lucide-react";

export function VerifiedChip({ verified }: { verified: boolean }) {
  return verified ? (
    <span className="chip chip-ok"><Check size={10} strokeWidth={2.6} />Verified</span>
  ) : (
    <span className="chip chip-warn"><AlertCircle size={10} strokeWidth={2.2} />Unverified</span>
  );
}

export function StatusChip({ status }: { status: "sent" | "failed" | "pending" }) {
  if (status === "sent") return <span className="chip chip-ok"><Check size={10} strokeWidth={2.6} />Delivered</span>;
  if (status === "failed") return <span className="chip chip-err"><X size={10} strokeWidth={2.6} />Failed</span>;
  return <span className="chip chip-pending"><Clock size={10} strokeWidth={2.2} />Delivering…</span>;
}
