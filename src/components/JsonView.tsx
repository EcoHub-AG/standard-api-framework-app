import { useState } from "react";
import { copyText } from "../lib/format";

// Read-only JSON viewer with per-value truncation: long strings (base64
// ciphertext, signatures, encryption keys — the usual suspects in a raw SAF
// envelope) collapse to a short preview with a "see more" toggle instead of
// pushing the whole block out to many screens of scroll.
const LONG_THRESHOLD = 60;
const PREVIEW_LEN = 36;

// A field like AIDSPM's "structuredPayload" carries an entire XML (or
// sometimes JSON) document *as a string*. Once that string sits inside a
// JSON value, re-serializing the outer object for display necessarily
// escapes its embedded quotes/newlines (\" / \n) — that's just JSON syntax,
// not double-encoding. Detect that case and show/copy the string's real
// value directly instead, so it's already valid, pasteable XML/JSON with no
// manual unescaping needed.
function detectEmbeddedDocument(s: string): "xml" | "json" | null {
  const trimmed = s.trim();
  if (/^<\?xml|^</.test(trimmed)) return "xml";
  if (/^[{[]/.test(trimmed)) {
    try {
      JSON.parse(trimmed);
      return "json";
    } catch {
      return null;
    }
  }
  return null;
}

function EmbeddedDocument({ full, kind }: { full: string; kind: "xml" | "json" }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const parsedJson = kind === "json" ? (() => { try { return JSON.parse(full); } catch { return null; } })() : null;

  return (
    <span className="jv-str">
      "[{kind === "xml" ? "XML" : "JSON"} document, {full.length} chars]"
      <button type="button" className="jv-toggle" onClick={() => setOpen((o) => !o)}>
        {open ? "hide" : `view as ${kind === "xml" ? "XML" : "JSON"}`}
      </button>
      {open && (
        <span className="jv-embed">
          <span className="jv-embed-head">
            <span className="jv-embed-lbl">{kind === "xml" ? "XML" : "JSON"} (unescaped)</span>
            <button
              type="button"
              className="jv-toggle"
              onClick={() => { copyText(full); setCopied(true); setTimeout(() => setCopied(false), 1200); }}
            >
              {copied ? "copied" : "copy"}
            </button>
          </span>
          <span className="jv-embed-body code-block-bounded">
            {kind === "xml" || parsedJson === null ? full : <Value value={parsedJson} indent={0} />}
          </span>
        </span>
      )}
    </span>
  );
}

function StringValue({ full }: { full: string }) {
  const [open, setOpen] = useState(false);
  const docKind = full.length > LONG_THRESHOLD ? detectEmbeddedDocument(full) : null;
  if (docKind) return <EmbeddedDocument full={full} kind={docKind} />;
  if (full.length <= LONG_THRESHOLD) return <span className="jv-str">"{full}"</span>;
  return (
    <span className="jv-str">
      "{open ? full : full.slice(0, PREVIEW_LEN) + "…"}"
      <button type="button" className="jv-toggle" onClick={() => setOpen((o) => !o)}>
        {open ? "see less" : `see more (${full.length} chars)`}
      </button>
    </span>
  );
}

function Value({ value, indent }: { value: any; indent: number }) {
  if (value === null || value === undefined) return <span className="jv-null">null</span>;
  if (typeof value === "string") return <StringValue full={value} />;
  if (typeof value === "number" || typeof value === "boolean") return <span className="jv-lit">{String(value)}</span>;
  if (Array.isArray(value)) return <ArrayValue value={value} indent={indent} />;
  if (typeof value === "object") return <ObjectValue value={value} indent={indent} />;
  return <span>{String(value)}</span>;
}

function ObjectValue({ value, indent }: { value: Record<string, any>; indent: number }) {
  const keys = Object.keys(value);
  if (keys.length === 0) return <>{"{}"}</>;
  const pad = "  ".repeat(indent + 1);
  const closePad = "  ".repeat(indent);
  return (
    <>
      {"{\n"}
      {keys.map((k, i) => (
        <span key={k}>
          {pad}
          <span className="jv-key">"{k}"</span>: <Value value={value[k]} indent={indent + 1} />
          {i < keys.length - 1 ? "," : ""}
          {"\n"}
        </span>
      ))}
      {closePad}
      {"}"}
    </>
  );
}

function ArrayValue({ value, indent }: { value: any[]; indent: number }) {
  if (value.length === 0) return <>{"[]"}</>;
  const pad = "  ".repeat(indent + 1);
  const closePad = "  ".repeat(indent);
  return (
    <>
      {"[\n"}
      {value.map((v, i) => (
        <span key={i}>
          {pad}
          <Value value={v} indent={indent + 1} />
          {i < value.length - 1 ? "," : ""}
          {"\n"}
        </span>
      ))}
      {closePad}
      {"]"}
    </>
  );
}

export default function JsonView({ data, className }: { data: any; className?: string }) {
  return (
    <pre className={"code-block jv-root" + (className ? " " + className : "")}>
      <Value value={data} indent={0} />
    </pre>
  );
}
