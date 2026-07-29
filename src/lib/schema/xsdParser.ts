// Converts a legacy XSD (invoice/commission/contract/mandate/claimsExperience)
// into the FieldSchema shape FormTree renders, plus seeds default form values
// from the real Testfiles/*.xml sample in EcoHub-AG/Standards.
//
// Conventions used in the `values` object that goes with a FieldSchema:
//  - object children: plain nested keys, same as element names.
//  - array (maxOccurs>1/unbounded): a JS array of item values.
//  - attributes: collected under the reserved key "@attributes" as a flat object.
//  - choice: collected under a reserved key (e.g. "_choice", "_choice2", ...)
//    whose value is `{ "@selected": "<optionLabel>", "<optionLabel>": {...} }`.
import type { FieldSchema } from "../formSchema";
import { fetchText, resolveUrl } from "./loader";
import { legacyStandardsBase, type LegacyXsdDef } from "../../data/standards";

const XS = "http://www.w3.org/2001/XMLSchema";
const parser = new DOMParser();

function children(el: Element, localName: string): Element[] {
  return Array.from(el.children).filter((c) => c.localName === localName && c.namespaceURI === XS);
}
function child(el: Element, localName: string): Element | undefined {
  return children(el, localName)[0];
}

type Registry = { complexTypes: Map<string, Element>; simpleTypes: Map<string, Element>; elements: Map<string, Element> };

async function loadDoc(url: string): Promise<Document> {
  const text = await fetchText(url);
  return parser.parseFromString(text, "application/xml");
}

/** Fetch the root xsd + its xs:include chain, merge all top-level type/element defs into one registry. */
async function buildRegistry(rootUrl: string): Promise<{ registry: Registry; rootDoc: Document }> {
  const registry: Registry = { complexTypes: new Map(), simpleTypes: new Map(), elements: new Map() };
  const seen = new Set<string>();
  let rootDoc: Document | null = null;

  async function ingest(url: string) {
    if (seen.has(url)) return;
    seen.add(url);
    const doc = await loadDoc(url);
    if (!rootDoc) rootDoc = doc;
    const root = doc.documentElement;
    for (const ct of children(root, "complexType")) {
      const name = ct.getAttribute("name");
      if (name) registry.complexTypes.set(name, ct);
    }
    for (const st of children(root, "simpleType")) {
      const name = st.getAttribute("name");
      if (name) registry.simpleTypes.set(name, st);
    }
    for (const e of children(root, "element")) {
      const name = e.getAttribute("name");
      if (name) registry.elements.set(name, e);
    }
    for (const inc of children(root, "include")) {
      const loc = inc.getAttribute("schemaLocation");
      if (loc) await ingest(resolveUrl(url, loc));
    }
  }

  await ingest(rootUrl);
  return { registry, rootDoc: rootDoc! };
}

const BUILTIN_LEAF: Record<string, FieldSchema["kind"]> = {
  string: "string", token: "string", normalizedString: "string", anyURI: "string",
  ID: "string", IDREF: "string", base64Binary: "string", hexBinary: "string",
  date: "string", dateTime: "string", time: "string", gYear: "string", gYearMonth: "string",
  decimal: "number", double: "number", float: "number",
  integer: "integer", int: "integer", long: "integer", short: "integer",
  nonNegativeInteger: "integer", positiveInteger: "integer", nonPositiveInteger: "integer", negativeInteger: "integer",
  boolean: "boolean",
};

function stripNs(qname: string): string {
  const i = qname.indexOf(":");
  return i === -1 ? qname : qname.slice(i + 1);
}

function builtinLeaf(typeName: string): FieldSchema | null {
  const local = stripNs(typeName);
  const kind = BUILTIN_LEAF[local];
  if (!kind) return null;
  const withFormat = local === "date" || local === "dateTime" || local === "time";
  return withFormat ? ({ kind, format: local } as FieldSchema) : ({ kind } as FieldSchema);
}

let choiceCounter = 0;

function walkSimpleType(st: Element, registry: Registry): FieldSchema {
  const restriction = child(st, "restriction");
  if (!restriction) return { kind: "string" };
  const enums = children(restriction, "enumeration").map((e) => e.getAttribute("value") ?? "");
  if (enums.length) return { kind: "enum", values: enums };
  const base = restriction.getAttribute("base") ?? "";
  const builtin = builtinLeaf(base);
  if (builtin) return builtin;
  const namedSimple = registry.simpleTypes.get(stripNs(base));
  if (namedSimple) return walkSimpleType(namedSimple, registry);
  return { kind: "string" };
}

/** Walk a <xs:sequence>/<xs:choice>/<xs:all> container's element children into object properties. */
function walkContainer(
  container: Element,
  registry: Registry,
  properties: Record<string, FieldSchema>,
  required: string[]
): Promise<void>[] {
  const jobs: Promise<void>[] = [];
  for (const node of Array.from(container.children)) {
    if (node.namespaceURI !== XS) continue;
    if (node.localName === "element") {
      const name = node.getAttribute("name");
      if (!name) continue;
      const minOccurs = node.getAttribute("minOccurs");
      jobs.push(
        walkElementDecl(node, registry).then((schema) => {
          properties[name] = schema;
          if (minOccurs !== "0") required.push(name);
        })
      );
    } else if (node.localName === "choice") {
      const key = `_choice${++choiceCounter === 1 ? "" : choiceCounter}`;
      jobs.push(
        walkChoice(node, registry).then((schema) => {
          properties[key] = schema;
        })
      );
    } else if (node.localName === "sequence" || node.localName === "all") {
      jobs.push(...walkContainer(node, registry, properties, required).map((p) => p));
    } else if (node.localName === "group" || node.localName === "any") {
      const key = `_unsupported${Object.keys(properties).length}`;
      properties[key] = { kind: "unsupported", note: `Uses <xs:${node.localName}> — edit this section as raw XML.` };
    }
  }
  return jobs;
}

async function walkChoice(choiceEl: Element, registry: Registry): Promise<FieldSchema> {
  const maxOccurs = choiceEl.getAttribute("maxOccurs");
  if (maxOccurs && maxOccurs !== "1") {
    return { kind: "unsupported", note: "Repeatable <xs:choice> groups aren't supported by the structured editor — edit as raw XML." };
  }
  const options: { label: string; schema: FieldSchema }[] = [];
  for (const node of children(choiceEl, "element")) {
    const name = node.getAttribute("name");
    if (!name) continue;
    options.push({ label: name, schema: await walkElementDecl(node, registry) });
  }
  return { kind: "choice", options };
}

async function walkComplexType(ct: Element, registry: Registry): Promise<FieldSchema> {
  const properties: Record<string, FieldSchema> = {};
  const required: string[] = [];
  const attributes: Record<string, FieldSchema> = {};

  const complexContent = child(ct, "complexContent");
  let body: Element = ct;
  if (complexContent) {
    const ext = child(complexContent, "extension");
    if (ext) {
      const base = ext.getAttribute("base") ?? "";
      const baseType = registry.complexTypes.get(stripNs(base));
      if (baseType) {
        const baseSchema = await walkComplexType(baseType, registry);
        if (baseSchema.kind === "object") {
          Object.assign(properties, baseSchema.properties);
          required.push(...baseSchema.required);
          if (baseSchema.attributes) Object.assign(attributes, baseSchema.attributes);
        }
      }
      body = ext;
    }
  }

  const seq = child(body, "sequence");
  const choice = child(body, "choice");
  const all = child(body, "all");
  const jobs: Promise<void>[] = [];
  if (seq) jobs.push(...walkContainer(seq, registry, properties, required));
  if (all) jobs.push(...walkContainer(all, registry, properties, required));
  if (choice) {
    const key = `_choice${++choiceCounter === 1 ? "" : choiceCounter}`;
    jobs.push(walkChoice(choice, registry).then((s) => { properties[key] = s; }));
  }
  await Promise.all(jobs);

  for (const attr of children(ct, "attribute")) {
    const name = attr.getAttribute("name");
    if (!name) continue;
    const typeAttr = attr.getAttribute("type");
    const inlineSimple = child(attr, "simpleType");
    let schema: FieldSchema = { kind: "string" };
    if (inlineSimple) schema = walkSimpleType(inlineSimple, registry);
    else if (typeAttr) schema = builtinLeaf(typeAttr) ?? walkSimpleType(registry.simpleTypes.get(stripNs(typeAttr)) ?? ct, registry);
    attributes[name] = schema;
  }

  return { kind: "object", properties, required, attributes: Object.keys(attributes).length ? attributes : undefined };
}

/** Resolve a single <xs:element> declaration (inline type, named type ref, or occurs-wrapped) into FieldSchema. */
async function walkElementDecl(el: Element, registry: Registry): Promise<FieldSchema> {
  const maxOccurs = el.getAttribute("maxOccurs");
  const isArray = maxOccurs === "unbounded" || (!!maxOccurs && Number(maxOccurs) > 1);

  let base: FieldSchema;
  const inlineComplex = child(el, "complexType");
  const inlineSimple = child(el, "simpleType");
  const typeAttr = el.getAttribute("type");

  if (inlineComplex) {
    base = await walkComplexType(inlineComplex, registry);
  } else if (inlineSimple) {
    base = walkSimpleType(inlineSimple, registry);
  } else if (typeAttr) {
    const local = stripNs(typeAttr);
    const builtin = builtinLeaf(typeAttr);
    if (builtin) base = builtin;
    else if (registry.complexTypes.has(local)) base = await walkComplexType(registry.complexTypes.get(local)!, registry);
    else if (registry.simpleTypes.has(local)) base = walkSimpleType(registry.simpleTypes.get(local)!, registry);
    else base = { kind: "string" };
  } else {
    base = { kind: "string" };
  }

  return isArray ? { kind: "array", items: base } : base;
}

export type XsdFormResult = { schema: FieldSchema; rootElementName: string };

/** Parse a legacy process's root XSD (given its root schema URL and root element name) into a FieldSchema. */
export async function parseXsdForm(rootSchemaUrl: string, rootElementName: string): Promise<XsdFormResult> {
  choiceCounter = 0;
  const { registry, rootDoc } = await buildRegistry(rootSchemaUrl);
  const rootEl =
    Array.from(rootDoc.documentElement.children).find(
      (c) => c.namespaceURI === XS && c.localName === "element" && c.getAttribute("name") === rootElementName
    ) ?? registry.elements.get(rootElementName);
  if (!rootEl) throw new Error(`Root element "${rootElementName}" not found in ${rootSchemaUrl}`);
  const schema = await walkElementDecl(rootEl, registry);
  return { schema, rootElementName };
}

/** Fetch + parse a legacy process's XSD form schema and its seed sample values, given its standards.ts metadata. */
export async function loadLegacyForm(def: LegacyXsdDef): Promise<{ schema: FieldSchema; sample: any }> {
  const base = legacyStandardsBase(def);
  const [{ schema }, sample] = await Promise.all([
    parseXsdForm(`${base}/${def.xsdFile}`, def.rootElementName),
    parseSampleXml(`${base}/Testfiles/${encodeURIComponent(def.sampleFile)}`),
  ]);
  return { schema, sample };
}

/** Parse a sample XML test file into a plain values object matching a FieldSchema's conventions. */
export async function parseSampleXml(xmlUrl: string): Promise<any> {
  const text = await fetchText(xmlUrl);
  const doc = parser.parseFromString(text, "application/xml");
  return elementToValue(doc.documentElement);
}

function elementToValue(el: Element): any {
  const out: any = {};
  const attrs: any = {};
  for (const a of Array.from(el.attributes)) attrs[a.name] = a.value;
  if (Object.keys(attrs).length) out["@attributes"] = attrs;

  const childEls = Array.from(el.children);
  const grouped = new Map<string, Element[]>();
  for (const c of childEls) {
    const list = grouped.get(c.localName) ?? [];
    list.push(c);
    grouped.set(c.localName, list);
  }
  for (const [name, els] of grouped) {
    if (els.length > 1) out[name] = els.map((e) => (e.children.length ? elementToValue(e) : e.textContent ?? ""));
    else out[name] = els[0].children.length ? elementToValue(els[0]) : els[0].textContent ?? "";
  }
  if (!childEls.length && !Object.keys(attrs).length) return el.textContent ?? "";
  return out;
}
