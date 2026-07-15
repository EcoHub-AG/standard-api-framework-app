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
function xmlBody(obj: any, depth: number): string {
  const pad = "  ".repeat(depth);
  return Object.keys(obj)
    .map((k) => {
      const v = obj[k];
      if (isObj(v)) return `${pad}<${k}>\n${xmlBody(v, depth + 1)}\n${pad}</${k}>`;
      if (Array.isArray(v)) return v.map((it) => (isObj(it) ? `${pad}<${k}>\n${xmlBody(it, depth + 1)}\n${pad}</${k}>` : `${pad}<${k}>${escXml(it)}</${k}>`)).join("\n");
      return `${pad}<${k}>${escXml(v)}</${k}>`;
    })
    .join("\n");
}
export const toXML = (root: string, ns: string, values: any) => `<${root} xmlns="${ns}">\n${xmlBody(values, 1)}\n</${root}>`;

export const chunk = (s: string, n: number) => s.replace(new RegExp("(.{" + n + "})", "g"), "$1\n").trim();
export function randB64(n: number) {
  const c = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  let s = "";
  for (let i = 0; i < n; i++) s += c[Math.floor(Math.random() * c.length)];
  return s;
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
