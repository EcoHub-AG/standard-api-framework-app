// Live JSON-Schema / XSD fetch + resolve layer, shared by envelope validation
// and the XSD-to-form converter. Everything is cached by absolute URL so a
// file referenced from many places (e.g. Generics/v1.0.0/*) is fetched once
// per session, and concurrent resolutions of the same file collapse into one
// in-flight request.
import { getText } from "./fetch";

export class SchemaFetchError extends Error {
  constructor(public url: string, public status: number, message: string) {
    super(message);
    this.name = "SchemaFetchError";
  }
}

export const API_SPECS_BASE = "https://raw.githubusercontent.com/EcoHub-AG/Api-Specs/async-rest-1.2.1";
export const STANDARDS_BASE = "https://raw.githubusercontent.com/EcoHub-AG/Standards";

export type ResolvedDoc = { url: string; json: any };

const docCache = new Map<string, Promise<ResolvedDoc>>();

/** Fetch + JSON.parse a schema/JSON document, cached by absolute URL. */
export function fetchDoc(url: string): Promise<ResolvedDoc> {
  let p = docCache.get(url);
  if (p) return p;
  p = (async () => {
    const r = await getText(url);
    if (!r.ok) throw new SchemaFetchError(url, r.status, `Failed to fetch ${url}: HTTP ${r.status}`);
    let json: any;
    try {
      json = JSON.parse(r.text);
    } catch (e) {
      throw new SchemaFetchError(url, r.status, `${url} did not return valid JSON: ${String((e as Error).message)}`);
    }
    return { url, json };
  })();
  docCache.set(url, p);
  return p;
}

/** Fetch raw text (used for XSD / XML files, which aren't JSON). Cached by absolute URL. */
const textCache = new Map<string, Promise<string>>();
export function fetchText(url: string): Promise<string> {
  let p = textCache.get(url);
  if (p) return p;
  p = (async () => {
    const r = await getText(url);
    if (!r.ok) throw new SchemaFetchError(url, r.status, `Failed to fetch ${url}: HTTP ${r.status}`);
    return r.text;
  })();
  textCache.set(url, p);
  return p;
}

/** Resolve a JSON Schema "$ref" (relative path + optional "#/json/pointer") against a base URL. */
export async function resolveRef(baseUrl: string, ref: string): Promise<{ url: string; node: any }> {
  const [pathPart, pointer] = ref.split("#");
  const url = pathPart ? new URL(pathPart, baseUrl).toString() : baseUrl;
  const doc = await fetchDoc(url);
  let node = doc.json;
  if (pointer) {
    for (const seg of pointer.split("/").filter(Boolean)) {
      const key = seg.replace(/~1/g, "/").replace(/~0/g, "~");
      node = node?.[key];
    }
  }
  return { url, node };
}

/** Resolve a sibling-relative URL (used for XSD xs:include schemaLocation). */
export function resolveUrl(baseUrl: string, relative: string): string {
  return new URL(relative, baseUrl).toString();
}

export function clearCache(): void {
  docCache.clear();
  textCache.clear();
}
