// Serialization helpers (JSON/XML) + path utilities for the nested form editor.
export const isObj = (v: any) => v && typeof v === "object" && !Array.isArray(v);
export const deepClone = <T,>(o: T): T => JSON.parse(JSON.stringify(o));

export function getPath(obj: any, path: string) {
  return path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);
}
export function setPath(obj: any, path: string, val: any) {
  const p = path.split(".");
  let o = obj;
  for (let i = 0; i < p.length - 1; i++) {
    if (!isObj(o[p[i]]) && !Array.isArray(o[p[i]])) o[p[i]] = {};
    o = o[p[i]];
  }
  o[p[p.length - 1]] = val;
}
export const humanize = (k: string) =>
  String(k).replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/^./, (c) => c.toUpperCase());

export const toJSON = (values: any) => JSON.stringify(values, null, 2);

const escXml = (s: any) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]!));
const escAttr = (s: any) => escXml(s).replace(/"/g, "&quot;");

// XSD-form value conventions (src/lib/schema/xsdParser.ts): "@attributes" is a flat
// bag rendered as XML attributes on the parent tag (not child elements); a key
// starting with "_choice" holds `{ "@selected": label, [label]: {...} }` and renders
// only the selected branch, unwrapped (the <xs:choice> itself has no element name).
function attrString(attrs: Record<string, any> | undefined): string {
  if (!attrs) return "";
  return Object.entries(attrs).map(([k, v]) => ` ${k}="${escAttr(v)}"`).join("");
}
function xmlBody(obj: any, depth: number): string {
  const pad = "  ".repeat(depth);
  return Object.keys(obj)
    .filter((k) => k !== "@attributes")
    .map((k) => {
      const v = obj[k];
      if (k.startsWith("_choice") && isObj(v)) {
        const selected = v["@selected"];
        const branch = selected != null ? v[selected] : undefined;
        if (selected == null || branch === undefined) return "";
        return isObj(branch)
          ? `${pad}<${selected}${attrString(branch["@attributes"])}>\n${xmlBody(branch, depth + 1)}\n${pad}</${selected}>`
          : `${pad}<${selected}>${escXml(branch)}</${selected}>`;
      }
      if (isObj(v)) return `${pad}<${k}${attrString(v["@attributes"])}>\n${xmlBody(v, depth + 1)}\n${pad}</${k}>`;
      if (Array.isArray(v))
        return v
          .map((it) =>
            isObj(it) ? `${pad}<${k}${attrString(it["@attributes"])}>\n${xmlBody(it, depth + 1)}\n${pad}</${k}>` : `${pad}<${k}>${escXml(it)}</${k}>`
          )
          .join("\n");
      return `${pad}<${k}>${escXml(v)}</${k}>`;
    })
    .filter(Boolean)
    .join("\n");
}
export const toXML = (root: string, ns: string, values: any) =>
  `<${root} xmlns="${ns}"${attrString(values?.["@attributes"])}>\n${xmlBody(values, 1)}\n</${root}>`;

export const chunk = (s: string, n: number) => s.replace(new RegExp("(.{" + n + "})", "g"), "$1\n").trim();
export function randB64(n: number) {
  const c = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  let s = "";
  for (let i = 0; i < n; i++) s += c[Math.floor(Math.random() * c.length)];
  return s;
}
/** Read a File as base64 (no "data:...;base64," prefix) — used for the file-upload-into-"data" flow. */
export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      const result = String(reader.result ?? "");
      const comma = result.indexOf(",");
      resolve(comma === -1 ? result : result.slice(comma + 1));
    };
    reader.readAsDataURL(file);
  });
}

/** Read a File as raw bytes — used so uploads (e.g. PDFs) are encrypted as their
 *  actual bytes rather than as the text of their base64 representation. */
export function fileToBytes(file: File): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.readAsArrayBuffer(file);
  });
}

export async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.select();
    try { document.execCommand("copy"); } catch {}
    document.body.removeChild(ta);
  }
}
