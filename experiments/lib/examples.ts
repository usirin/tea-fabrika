// Examples as data: one call and its exact result, run against a version of a toy's code.
import { isDeepStrictEqual } from "node:util";

export interface Example {
  readonly call: string;
  readonly result: string;
}

export type Outcome = { readonly ok: true; readonly value: unknown } | { readonly ok: false; readonly error: string };

/** Run one example's call against `source`, which exports `fn`. */
export async function outcome(source: string, fn: string, example: Example): Promise<Outcome> {
  try {
    const module = (await import(`data:text/javascript,${encodeURIComponent(source)}`)) as Record<string, unknown>;
    return { ok: true, value: new Function(fn, `return (${example.call});`)(module[fn]) };
  } catch (error) {
    return { ok: false, error: String(error) };
  }
}

/** The example's result as a value. */
export const expected = (example: Example): Outcome => {
  try {
    return { ok: true, value: new Function(`return (${example.result});`)() };
  } catch (error) {
    return { ok: false, error: String(error) };
  }
};

export const holds = (got: Outcome, want: Outcome) => got.ok && want.ok && isDeepStrictEqual(got.value, want.value);

/** Does `source` return the example's result? */
export const agrees = async (source: string, fn: string, example: Example) =>
  holds(await outcome(source, fn, example), expected(example));

/** A node:test file with one test per example, named `<id>: <call>`. */
export const testFile = (file: string, fn: string, examples: readonly (Example & { readonly id: string })[]) =>
  [
    `import assert from "node:assert/strict";`,
    `import test from "node:test";`,
    `import { ${fn} } from "./${file}";`,
    ``,
    ...examples.map(
      (e) => `test(${JSON.stringify(`${e.id}: ${e.call}`)}, () => {\n  assert.deepStrictEqual(${e.call}, ${e.result});\n});\n`,
    ),
  ].join("\n");
