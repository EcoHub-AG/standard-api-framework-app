import { elementToValue } from "./schema/xsdParser";

// Decrypted SAF cleartext isn't always JSON: newer standards send JSON, legacy
// ones (commission, billing, …) send XML, and generic events can carry anything.
// Detect which, so the Inbox can show a structured view or fall back to raw text.
export type DecodedPayload =
  | { kind: "json"; text: string; value: any }
  | { kind: "xml"; text: string; value: any }
  | { kind: "text"; text: string };

export function parsePayload(text: string): DecodedPayload {
  const t = text.trim();
  if (/^[{[]/.test(t)) {
    try { return { kind: "json", text, value: JSON.parse(t) }; } catch { /* fall through */ }
  }
  if (t.startsWith("<")) {
    const doc = new DOMParser().parseFromString(t, "application/xml");
    const root = doc.documentElement;
    if (root && !doc.getElementsByTagName("parsererror").length) {
      return { kind: "xml", text, value: { [root.localName]: elementToValue(root) } };
    }
  }
  return { kind: "text", text };
}
