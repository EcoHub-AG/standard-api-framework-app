// Demo data matching the mockups. In Phase 2 this is replaced by the backend service.
import type { MembershipType } from "../types";

export const MEMBERSHIP_TYPES: Record<MembershipType, { title: string; label: string; avatar: string; idp: string; counterparties: string[] }> = {
  insurer: { title: "SAF Insurer", label: "Insurer", avatar: "SI", idp: "10012345", counterparties: ["Helvetia Brokers", "Kessler & Co", "Aon Switzerland"] },
  broker: { title: "SAF Broker", label: "Broker", avatar: "SB", idp: "10067890", counterparties: ["Zürich Insurance", "Baloise", "AXA Switzerland"] },
  serviceprovider: { title: "SAF Service Provider", label: "Service Provider", avatar: "SP", idp: "10099999", counterparties: ["Helvetia Brokers", "Zürich Insurance"] },
};

export type InboxItem = {
  id: string; from: string; subject: string; topic: string; time: string;
  unread: boolean; verified: boolean; payload: Record<string, any>;
};

export const INBOX: InboxItem[] = [
  { id: "i1", from: "Helvetia Brokers", subject: "FNOL — motor collision A1", topic: "claims.fnol.v1", time: "09:41", unread: true, verified: true,
    payload: { event: "claim.notified", claimType: "motor.collision", policyNo: "CH-MOT-887421", lossDate: "2026-06-09", reportedBy: "M. Frei", description: "Rear-end collision, A1 near Winterthur. No injuries reported." } },
  { id: "i2", from: "Kessler & Co", subject: "Quote request — commercial property", topic: "quotes.request.v1", time: "08:17", unread: true, verified: true,
    payload: { event: "quote.requested", product: "property.commercial", insuredValue: 2400000, currency: "CHF", coverageStart: "2026-07-01", broker: "Kessler & Co" } },
  { id: "i3", from: "Aon Switzerland", subject: "Endorsement accepted", topic: "policy.endorsement.v1", time: "Yesterday", unread: false, verified: true,
    payload: { event: "endorsement.accepted", policyNo: "CH-PROP-553019", effectiveDate: "2026-07-01", status: "ACTIVE" } },
  { id: "i4", from: "Helvetia Brokers", subject: "Coverage confirmation requested", topic: "quotes.request.v1", time: "Mon", unread: false, verified: false,
    payload: { event: "coverage.confirm", reference: "Q-2026-3391", note: "Signature could not be verified — counterparty key not on file." } },
];

export type OutboxItem = {
  id: string; to: string; subject: string; topic: string; time: string;
  status: "sent" | "failed" | "pending"; payload: Record<string, any>;
};

export const OUTBOX: OutboxItem[] = [
  { id: "o1", to: "Zürich Insurance", subject: "Coverage confirmation", topic: "quotes.request.v1", time: "09:52", status: "sent", payload: { event: "coverage.confirmed", reference: "Q-2026-3391", premium: 4180, currency: "CHF" } },
  { id: "o2", to: "Baloise", subject: "FNOL acknowledgement", topic: "claims.fnol.v1", time: "09:08", status: "sent", payload: { event: "claim.acknowledged", claimNo: "CL-2026-77120" } },
  { id: "o3", to: "AXA Switzerland", subject: "Endorsement proposal", topic: "policy.endorsement.v1", time: "Yesterday", status: "failed", payload: { event: "endorsement.proposed", policyNo: "CH-PROP-553019" } },
];

export type KeyRow = { version: string; created: string; active: boolean; kind: "encryption" | "signature" };
export const KEYS: KeyRow[] = [
  { version: "3.0.0", created: "2026-06-12", active: true, kind: "encryption" },
  { version: "2.0.0", created: "2026-03-04", active: false, kind: "encryption" },
  { version: "3.0.0", created: "2026-06-12", active: true, kind: "signature" },
];
