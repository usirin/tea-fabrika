/**
 * x-ci-plant-1: a comment-only plant for experiment 288, never merged.
 *
 * Line 01 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 02 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 03 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 04 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 05 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 06 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 07 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 08 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 09 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 10 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 11 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 12 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 13 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 14 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 15 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 16 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 17 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 18 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 19 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 20 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 21 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 22 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 23 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 24 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 */
/**
 * The editor's JSON Schema for a settings file, written by Effect from the file's own schema (`Files.schema`), so validation and editor hints share one tree.
 *
 * **Details**
 *
 * A key no declaration names is refused, and a default is only an annotation. A leaf JSON Schema cannot hold exactly stops generation rather than shipping a looser schema.
 *
 * @stability unstable
 */
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

/**
 * Writes the JSON Schema document for a settings file's schema.
 *
 * **Details**
 *
 * The result is a draft 2020-12 document with its definitions under `$defs`, and excess properties are refused.
 *
 * **Gotchas**
 *
 * Throws an `Error` when any part of the schema would be written looser than it decodes: an opaque declaration, or a check with no exact JSON Schema form.
 *
 * @stability unstable
 * @category constructors
 */
export const make = (schema: Schema.Top) => {
  if (loose(Schema.toRepresentation(Schema.toCodecJson(schema)), new Set())) {
    throw new Error("A setting's schema cannot be written as JSON Schema without loosening it.");
  }

  const document = Schema.toJsonSchemaDocument(schema, { onExcessProperty: "error" });
  return { $schema: DIALECT, ...document.schema, $defs: document.definitions };
};

/**
 * Returns a document as the text that is committed: two-space JSON and one trailing newline.
 *
 * @stability unstable
 * @category combinators
 */
export const format = (document: ReturnType<typeof make>) => `${JSON.stringify(document, null, 2)}\n`;
