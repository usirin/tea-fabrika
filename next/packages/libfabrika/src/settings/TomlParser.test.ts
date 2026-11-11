// T664, P38 slice 1, next/: L9 of the approved plan, for the `Toml` service (`settings/Toml.ts`)
// and its first Layer on toml-eslint-parser 1.0.3 (`settings/TomlParser.ts`). Written before them.
//
// The shape these tests hold the modules to:
// - `Toml` is a `Context.Service` with `parse(text): Effect<TomlDocument, TomlError>`;
//   `TomlParser.layer` provides it.
// - `TomlDocument.value` is the document's values as plain tables. `TomlDocument.spans` holds one
//   entry per key/value and per table header: `{ path, line }`, where `path` is the key's segments
//   (`"a.b" = 1` is `["a.b"]`, `a.b = 1` is `["a", "b"]`) and `line` counts from 1.
// - Broken TOML fails with `TomlError`, carrying the parser's `line` and its `cause`.
import { describe, expect, it } from "@effect/vitest";
import { Effect, Exit } from "effect";
import * as fc from "fast-check";
import { Toml } from "./Toml.ts";
import * as TomlParser from "./TomlParser.ts";

const SEED = 119120; // the shared seed (AGENTS.md), so a red run repeats
const check = { seed: SEED, numRuns: 100 };

const parse = (text: string) =>
  Effect.runPromiseExit(
    Effect.gen(function* () {
      const toml = yield* Toml;
      return yield* toml.parse(text);
    }).pipe(Effect.provide(TomlParser.layer)),
  );

const segment = fc.stringMatching(/^[a-z][a-z0-9]{0,5}(-[a-z0-9]{1,3})?$/);

// One table and its keys, in one of the spellings TOML gives the same table.
const table = fc.record({
  name: segment,
  keys: fc.uniqueArray(segment, { minLength: 1, maxLength: 3 }),
  values: fc.array(fc.integer({ min: 0, max: 99999 }), { minLength: 3, maxLength: 3 }),
  spelling: fc.constantFrom("table", "dotted", "quoted-table", "quoted-key", "inline"),
});

const doc = fc.record({
  tables: fc.uniqueArray(table, { minLength: 1, maxLength: 3, selector: (t) => t.name }),
  // A key whose one segment holds a dot, beside the table it reads like.
  literal: fc.option(fc.integer({ min: 0, max: 99999 }), { nil: undefined }),
  // Before each line: blank lines or comment lines, and a trailing comment on the line itself.
  padding: fc.array(fc.record({ blank: fc.nat(2), comment: fc.boolean(), trailing: fc.boolean() }), {
    minLength: 16,
    maxLength: 16,
  }),
  crlf: fc.boolean(),
});

type Doc = typeof doc extends fc.Arbitrary<infer D> ? D : never;

/** The text, its values, and the line every leaf and every table header must have. */
const write = (d: Doc) => {
  const lines: Array<string> = [];
  const value: Record<string, unknown> = {};
  const leaves: Array<{ path: ReadonlyArray<string>; line: number }> = [];
  const headers: Array<{ path: ReadonlyArray<string>; line: number }> = [];
  let pad = 0;

  const put = (text: string) => {
    const p = d.padding[pad++ % d.padding.length]!;

    for (let n = 0; n < p.blank; n++) {
      lines.push("");
    }

    if (p.comment) {
      lines.push("# a comment, with = and [brackets] and a.dotted key");
    }

    lines.push(p.trailing ? `${text} # trailing` : text);
    return lines.length;
  };

  // TOML puts top-level keys before the first header, so headers come last.
  const top = d.tables.filter((t) => t.spelling !== "table" && t.spelling !== "quoted-table");
  const headed = d.tables.filter((t) => t.spelling === "table" || t.spelling === "quoted-table");
  const first = d.tables[0]!;

  if (d.literal !== undefined) {
    const key = `${first.name}.${first.keys[0]!}`;
    leaves.push({ path: [key], line: put(`"${key}" = ${d.literal}`) });
    value[key] = d.literal;
  }

  for (const t of top) {
    const inner: Record<string, unknown> = {};
    value[t.name] = inner;

    if (t.spelling === "inline") {
      const line = put(`${t.name} = { ${t.keys.map((k, n) => `${k} = ${t.values[n]}`).join(", ")} }`);
      t.keys.forEach((k, n) => {
        inner[k] = t.values[n];
        leaves.push({ path: [t.name, k], line });
      });
    } else {
      t.keys.forEach((k, n) => {
        const key = t.spelling === "dotted" ? `${t.name}.${k}` : `"${t.name}".'${k}'`;
        inner[k] = t.values[n];
        leaves.push({ path: [t.name, k], line: put(`${key} = ${t.values[n]}`) });
      });
    }
  }

  for (const t of headed) {
    const inner: Record<string, unknown> = {};
    value[t.name] = inner;
    headers.push({ path: [t.name], line: put(t.spelling === "table" ? `[${t.name}]` : `[ "${t.name}" ]`) });
    t.keys.forEach((k, n) => {
      inner[k] = t.values[n];
      leaves.push({ path: [t.name, k], line: put(`${k} = ${t.values[n]}`) });
    });
  }

  return { text: lines.join(d.crlf ? "\r\n" : "\n") + (d.crlf ? "\r\n" : "\n"), value, leaves, headers };
};

const same = (a: ReadonlyArray<string>, b: ReadonlyArray<string>) =>
  a.length === b.length && a.every((s, n) => s === b[n]);

describe("L9, TOML paths and lines stay right for every spelling", () => {
  it("values, and one span per leaf and header with its segments and line", async () => {
    await fc.assert(
      fc.asyncProperty(doc, async (d) => {
        const w = write(d);
        const exit = await parse(w.text);
        expect(Exit.isSuccess(exit), w.text).toBe(true);

        if (Exit.isSuccess(exit)) {
          expect(exit.value.value).toEqual(w.value);

          for (const want of [...w.leaves, ...w.headers]) {
            const found = exit.value.spans.filter((s) => same(s.path, want.path));
            expect(
              found.map((s) => s.line),
              `${JSON.stringify(want.path)} in\n${w.text}`,
            ).toEqual([want.line]);
          }
        }
      }),
      check,
    );
  });

  it("broken TOML fails with TomlError at the broken line, even beside a version line", async () => {
    // Both forms are ones toml-eslint-parser 1.0.3 reports on their own line: a missing value is
    // reported on the next line, so it is not used here.
    const broken = fc.constantFrom('bad = "never closed', "bad = ]", "bad = 1 2");
    await fc.assert(
      fc.asyncProperty(doc, broken, fc.nat(), async (d, line, at) => {
        const w = write(d);
        const eol = d.crlf ? "\r\n" : "\n";
        const lines = [`fabrika-version = "9.9.9"`, ...w.text.split(eol).slice(0, -1)];
        const n = 1 + (at % lines.length);
        lines.splice(n, 0, line);
        const exit = await parse(lines.join(eol) + eol);
        expect(exit._tag).toBe("Failure");

        if (Exit.isFailure(exit)) {
          const error = exit.cause.reasons.find((r) => r._tag === "Fail");
          expect(error?._tag === "Fail" ? error.error._tag : "none").toBe("TomlError");
          expect(error?._tag === "Fail" ? error.error.line : 0).toBe(n + 1);
        }
      }),
      check,
    );
  });
});
