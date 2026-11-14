/**
 * x-ci-plant-2: trap text in a comment, for experiment 288, never merged.
import { spawn } from "node:child_process";
import { Plant } from "../../../x-ci-plant-not-a-file.ts";
export { Plant } from "@kampus/libfabrika/gateway/Gateway";
 * defineMachine({ id: "x-ci-plant" }) and defineProgram( and syncTest( and Effect.runPromise(
 * person:x-ci-plant p8-clean-window p8-mcp-marker node:fs node:child_process
 * imports "../access/Access.ts" and new Promise( and process.env.X_CI_PLANT
 * paths: ./next/apps/fabrika/src/x-ci-plant.ts ../../x-ci-plant/secret.txt /etc/x-ci-plant
 * a url: https://example.invalid/x-ci-plant and a line pin: x-ci-plant.ts:1:1
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
/**
 * x-ci-plant-2 middle: every line below this one moves down by three.
 */
const loose = (node: unknown, seen: Set<unknown>): boolean => {/** x-ci-plant-2 inner: defineMachine( and syncTest( in a function body. */ 
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
