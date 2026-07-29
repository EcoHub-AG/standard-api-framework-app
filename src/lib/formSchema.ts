// Internal form-schema representation produced by the XSD converter
// (src/lib/schema/xsdParser.ts) and consumed by FormTree.tsx. This is the
// only structured-form path in the app — it exists solely for the 5 legacy
// processes that have a real XSD (invoice, commission, contract, mandate,
// claimsExperience). offer.nlpi / generic / ids have no XML schema and use a
// plain free-text "data" textarea instead (see SendEvent.tsx).
export type FieldSchema =
  | { kind: "object"; properties: Record<string, FieldSchema>; required: string[]; attributes?: Record<string, FieldSchema> }
  | { kind: "array"; items: FieldSchema }
  | { kind: "choice"; options: { label: string; schema: FieldSchema }[] }
  | { kind: "enum"; values: string[] }
  | { kind: "string" | "number" | "integer" | "boolean"; format?: string }
  | { kind: "unsupported"; note: string };

export const isObjectSchema = (s: FieldSchema): s is Extract<FieldSchema, { kind: "object" }> => s.kind === "object";
