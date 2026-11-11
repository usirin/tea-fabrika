// The editor's JSON Schema for a settings file, written by Effect from the file's own schema
// (`Files.schema`), so validation and editor hints share one tree. A key no declaration names is
// refused, a default is only an annotation, and a leaf JSON Schema cannot hold exactly stops
// generation rather than shipping a looser schema.
import { Predicate, Schema } from "effect";

const DIALECT = "https://json-schema.org/draft/2020-12/schema";

/** Whether a representation holds a node Effect writes as a looser JSON Schema than it decodes. */
const loose = (node: unknown, seen: Set<unknown>): boolean => {
  if (!Predicate.isObjectOrArray(node) || seen.has(node)) {
    return false;
  }

  seen.add(node);

  // An opaque declaration becomes `{}`; a check with no exact JSON Schema is left out or widened.
  if (!Array.isArray(node) && node._tag === "Declaration") {
    return true;
  }

  if (!Array.isArray(node) && (node._tag === "Filter" || node._tag === "FilterGroup")) {
    const write = Predicate.isObject(node.annotations) ? node.annotations.toJsonSchema : undefined;

    if (!Predicate.isFunction(write) || Array.isArray(write({ type: undefined, schemas: [] }))) {
      return true;
    }
  }

  return Object.values(node).some((value) => loose(value, seen));
};

export const make = (schema: Schema.Top) => {
  if (loose(Schema.toRepresentation(Schema.toCodecJson(schema)), new Set())) {
    throw new Error("A setting's schema cannot be written as JSON Schema without loosening it.");
  }

  const document = Schema.toJsonSchemaDocument(schema, { onExcessProperty: "error" });
  return { $schema: DIALECT, ...document.schema, $defs: document.definitions };
};

/** The committed bytes: two-space JSON and one trailing newline. */
export const format = (document: ReturnType<typeof make>) => `${JSON.stringify(document, null, 2)}\n`;
