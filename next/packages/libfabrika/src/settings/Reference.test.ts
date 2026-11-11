// T730, P38 slice 2, next/: L3, L5, L6 and L10 of the approved plan, for `settings/Reference.ts`.
// Written before the module.
//
// The shape these tests hold the module to:
// - `Reference.Row` is the plan's Schema: `path`, `value`, `origin` (a `Sources.Origin`), `default`,
//   `doc`, `scope`, `reload` and `since`.
// - `Reference.rows(group, snapshot)` gives one row per declaration, sorted by path: the value and
//   origin the snapshot holds at the declaration's path, and the declaration's default encoded by
//   its JSON codec, doc, scope, reload and since. A snapshot key no declaration names never
//   becomes a row.
// - `Reference.warnings(rows, minimum)` gives `{ path, since, minimum }` for each row whose origin
//   is not `default` and whose `since` is a newer release than `minimum`, compared as three whole
//   numbers, never as text.
// - `Reference.markdown(group)` is the generated reference: for each declaration its path, scope,
//   environment name, flag (`--` and the path), reload, since, default and doc, in Markdown that
//   keeps the doc's meaning whatever punctuation it holds.
import { describe, expect, it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import { Digest } from "effect/crypto";
import * as fc from "fast-check";
import * as Reference from "./Reference.ts";
import * as Setting from "./Setting.ts";
import * as Snapshot from "./Snapshot.ts";
import * as Sources from "./Sources.ts";

const SEED = 119120; // the shared seed (AGENTS.md), so a red run repeats
const check = { seed: SEED, numRuns: 100 };
const PERSON = "~/.fabrika/fabrika.toml";
const REPO = ".fabrika/fabrika.toml";

const Port = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 65535 })).annotate({
  title: "a port",
  description: "A port is a whole number from 1 to 65535.",
});

// Release triples near 9 and 10, where text order and number order part.
const part = fc.oneof(fc.integer({ min: 0, max: 12 }), fc.integer({ min: 90, max: 110 }));
const release = fc.tuple(part, part, part).map((t) => t.join("."));

const segment = fc.stringMatching(/^[a-z][a-z0-9]{0,5}$/);
const scopes = fc.constantFrom<Setting.Scope>(["person"], ["repo"], ["person", "repo"], ["repo", "person"]);

// Words with Markdown punctuation and line breaks.
const doc = fc
  .array(
    fc.oneof(
      fc.stringMatching(/^[a-z]{1,8}$/),
      fc.constantFrom("|", "*", "_", "`", "#", "<b>", "[x](y)", "\\", "\n", "&", "--"),
    ),
    { minLength: 1, maxLength: 8 },
  )
  .map((words) => words.join(" "));

const port = fc.integer({ min: 1, max: 65535 });

/** Declarations of ports at two-segment paths, each with its own words, default and release. */
const declared = fc.uniqueArray(
  fc.record({
    table: segment,
    key: segment,
    doc,
    default: port,
    scope: scopes,
    reload: fc.constantFrom<Setting.Reload>("live", "restart"),
    since: release,
    // Where its value comes from: a flag, the environment, a file, or nowhere, so its default.
    source: fc.constantFrom("flag", "env", "person", "default"),
    value: port,
  }),
  { minLength: 1, maxLength: 5, selector: (d) => `${d.table}.${d.key}` },
);

type Declared = typeof declared extends fc.Arbitrary<infer D> ? D : never;

const grouped = (ds: Declared) =>
  Setting.group(
    Object.fromEntries(
      ds.map((d, n) => [
        `s${n}`,
        Setting.make(`${d.table}.${d.key}`, {
          schema: Port,
          default: d.default,
          doc: d.doc,
          scope: d.scope,
          reload: d.reload,
          since: d.since,
        }),
      ]),
    ),
  );

/** The snapshot a real resolve gives for the generated sources. */
const loaded = async (ds: Declared) => {
  const group = grouped(ds);
  const flags: Record<string, string> = {};
  const env: Record<string, string> = {};
  const person: Record<string, Record<string, number>> = {};
  ds.forEach((d, n) => {
    const s = group.declarations[n]!;

    if (d.source === "flag") {
      flags[s.path] = String(d.value);
    }

    if (d.source === "env") {
      env[s.env] = String(d.value);
    }

    if (d.source === "person") {
      person[d.table] = { ...person[d.table], [d.key]: d.value };
    }
  });
  const snapshot = await Effect.runPromise(
    Sources.resolve(group, {
      flags: Sources.flags(flags),
      env: Sources.env(env),
      repo: Sources.file(REPO, { value: {}, spans: [] }),
      person: Sources.file(PERSON, { value: person, spans: [] }),
    }).pipe(
      Effect.flatMap((resolved) => Snapshot.make(group, resolved)),
      Effect.provide(Digest.layerWebCrypto),
    ),
  );
  return { group, snapshot };
};

const triple = (version: string) => version.split(".").map(Number);

/** Whether release `a` is newer than `b`, by whole numbers. */
const newer = (a: string, b: string) => {
  const [x, y] = [triple(a), triple(b)];
  const n = x.findIndex((p, i) => p !== y[i]);
  return n >= 0 && x[n]! > y[n]!;
};

describe("L5, rows carry the snapshot's values and origins, and only declared keys", () => {
  it("one row per declaration, by path, with the snapshot's value and origin and the declaration's metadata", async () => {
    await fc.assert(
      fc.asyncProperty(declared, fc.dictionary(segment, port, { maxKeys: 2 }), async (ds, stray) => {
        const { group, snapshot } = await loaded(ds);
        // Keys no declaration names, such as a field a later release dropped, stay out of the rows.
        const extra = Object.fromEntries(Object.entries(stray).map(([k, v]) => [`zz-${k}.stray`, v]));
        const widened: Snapshot.Snapshot = {
          ...snapshot,
          values: { ...snapshot.values, ...extra },
          origins: {
            ...snapshot.origins,
            ...Object.fromEntries(Object.keys(extra).map((k) => [k, { _tag: "flag" as const, name: `--${k}` }])),
          },
        };
        const rows = Reference.rows(group, widened);
        const paths = group.declarations.map((d) => d.path).sort();
        expect(rows.map((r) => r.path)).toEqual(paths);

        for (const row of rows) {
          expect(Schema.is(Reference.Row)(row)).toBe(true);
          const d = group.declarations.find((d) => d.path === row.path)!;
          expect(row.value).toEqual(snapshot.values[d.path]);
          expect(row.origin).toEqual(snapshot.origins[d.path]);
          expect(row.default).toEqual(Schema.encodeSync(Schema.toCodecJson(d.schema))(d.default));
          expect(row.doc).toBe(d.doc);
          expect(row.scope).toEqual(d.scope);
          expect(row.reload).toBe(d.reload);
          // L10: the release metadata reaches the rows as declared.
          expect(row.since).toBe(d.since);
        }
      }),
      check,
    );
  });
});

describe("L6, a warning names exactly the explicit keys newer than the repo's minimum", () => {
  it("explicit rows whose since is a newer release than the minimum, by number, and no default row", async () => {
    await fc.assert(
      fc.asyncProperty(declared, release, async (ds, minimum) => {
        const { group, snapshot } = await loaded(ds);
        const rows = Reference.rows(group, snapshot);
        const want = rows
          .filter((r) => r.origin._tag !== "default" && newer(r.since, minimum))
          .map((r) => ({ path: r.path, since: r.since, minimum }));
        const got = Reference.warnings(rows, minimum).map((w) => ({
          path: w.path,
          since: w.since,
          minimum: w.minimum,
        }));
        expect([...got].sort((a, b) => (a.path < b.path ? -1 : 1))).toEqual(want);
      }),
      {
        ...check,
        // pinned: text order puts 9 after 10; by number 0.10.0 is the newer release.
        examples: [
          [
            [
              {
                table: "a",
                key: "b",
                doc: "d",
                default: 1,
                scope: ["person"] as Setting.Scope,
                reload: "restart" as const,
                since: "0.10.0",
                source: "flag",
                value: 2,
              },
            ],
            "0.9.0",
          ],
        ],
      },
    );
  });
});

/** The reference as a reader sees it: Markdown escapes and line breaks undone, spaces collapsed. */
const plain = (text: string) =>
  text
    .replace(/<br\s*\/?>/g, " ")
    .replace(/\\([\\`*_{}[\]()#+\-.!|<>~&])/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#124;|&vert;|&#x7[cC];/g, "|")
    .replace(/&#96;/g, "`")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");

const collapse = (text: string) => text.replace(/\s+/g, " ").trim();

describe("L3, the reference keeps each declaration's words, default, scope and release", () => {
  it("every declaration's path, scope, env, flag, reload, since, default and doc are in the reference", () => {
    fc.assert(
      fc.property(declared, (ds) => {
        const group = grouped(ds);
        const text = plain(Reference.markdown(group));

        for (const d of group.declarations) {
          for (const shown of [d.path, d.env, `--${d.path}`, d.since, d.reload, ...d.scope]) {
            expect(text, shown).toContain(shown);
          }

          expect(text).toContain(JSON.stringify(Schema.encodeSync(Schema.toCodecJson(d.schema))(d.default)));
          expect(text, d.doc).toContain(collapse(d.doc));
        }
      }),
      check,
    );
  });
});
