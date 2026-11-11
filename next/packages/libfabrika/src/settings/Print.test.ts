// T730, P38 slice 2, next/: L5 and output escaping of the approved plan, for `settings/Print.ts`
// over real source resolution. Written before the module.
//
// The shape these tests hold the module to:
// - `Print.report(rows, { all })` is the plain-text report `fabrika settings` prints, from
//   `Reference.rows`. A row is shown when its origin is not `default`, or every row with
//   `all: true`; the filter reads `origin._tag`, never the value. Rows keep their path order.
// - A shown row starts on a line of its own with its path, and its lines, up to the next row's,
//   hold its value, its origin (a file's name and line, a flag's or environment variable's name),
//   its default and its doc. `all` changes which rows show, never what a shown row says.
import { describe, expect, it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import { Digest } from "effect/crypto";
import * as fc from "fast-check";
import * as Print from "./Print.ts";
import * as Reference from "./Reference.ts";
import * as Setting from "./Setting.ts";
import * as Snapshot from "./Snapshot.ts";
import * as Sources from "./Sources.ts";
import { Toml } from "./Toml.ts";
import * as TomlParser from "./TomlParser.ts";

const SEED = 119120; // the shared seed (AGENTS.md), so a red run repeats
const check = { seed: SEED, numRuns: 100 };
const PERSON = "~/.fabrika/fabrika.toml";
const REPO = ".fabrika/fabrika.toml";

const Port = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 65535 }));
const port = fc.integer({ min: 1, max: 65535 });
const segment = fc.stringMatching(/^[a-z][a-z0-9]{0,5}$/);

// Words with Markdown punctuation and line breaks, which plain text must keep.
const doc = fc
  .array(
    fc.oneof(fc.stringMatching(/^[a-z]{1,8}$/), fc.constantFrom("|", "*", "_", "`", "#", "<b>", "\\", "\n", "\t", '"')),
    { minLength: 1, maxLength: 8 },
  )
  .map((words) => words.join(" "));

const SOURCES = ["flag", "env", "repo", "person"] as const;
type Slot = (typeof SOURCES)[number];

/** Port declarations, each with values in some sources: often its own default, or one shared value. */
const declared = port.chain((shared) =>
  fc.uniqueArray(
    fc.record({
      table: segment,
      key: segment,
      doc,
      default: fc.oneof(fc.constant(shared), port),
      scope: fc.constantFrom<Setting.Scope>(["person"], ["repo", "person"]),
      supplied: fc.record(
        Object.fromEntries(
          SOURCES.map((s) => [s, fc.oneof(fc.constant("default" as const), fc.constant(shared), port)]),
        ) as Record<Slot, fc.Arbitrary<number | "default">>,
        { requiredKeys: [] },
      ),
    }),
    { minLength: 1, maxLength: 4, selector: (d) => `${d.table}.${d.key}` },
  ),
);

type Declared = typeof declared extends fc.Arbitrary<infer D> ? D : never;

/** A TOML file of `[table]` blocks, so the parser gives each leaf a real line. */
const fileText = (entries: ReadonlyArray<readonly [string, string, number]>) => {
  const tables = new Map<string, Array<string>>();

  for (const [table, key, value] of entries) {
    tables.set(table, [...(tables.get(table) ?? []), `${key} = ${value}`]);
  }

  return `${["# generated", ...[...tables].flatMap(([table, lines]) => ["", `[${table}]`, ...lines])].join("\n")}\n`;
};

/** The rows of one real load: generated sources resolved, snapshotted and joined to their declarations. */
const loadRows = (ds: Declared) =>
  Effect.gen(function* () {
    const group = Setting.group(
      Object.fromEntries(
        ds.map((d, n) => [
          `s${n}`,
          Setting.make(`${d.table}.${d.key}`, {
            schema: Port,
            default: d.default,
            doc: d.doc,
            scope: d.scope,
            reload: "restart",
            since: "0.0.0",
          }),
        ]),
      ),
    );
    const value = (d: Declared[number], slot: Slot) => {
      const v = d.supplied[slot];
      // "default" supplies the declaration's own default explicitly.
      return v === undefined ? undefined : v === "default" ? d.default : v;
    };
    const flags: Record<string, string> = {};
    const env: Record<string, string> = {};
    const files: Record<"repo" | "person", Array<readonly [string, string, number]>> = { repo: [], person: [] };
    ds.forEach((d, n) => {
      const s = group.declarations[n]!;
      const [f, e, r, p] = SOURCES.map((slot) => value(d, slot));

      if (f !== undefined) {
        flags[s.path] = String(f);
      }

      if (e !== undefined) {
        env[s.env] = String(e);
      }

      if (r !== undefined && d.scope.includes("repo")) {
        files.repo.push([d.table, d.key, r]);
      }

      if (p !== undefined) {
        files.person.push([d.table, d.key, p]);
      }
    });
    const toml = yield* Toml;
    const resolved = yield* Sources.resolve(group, {
      flags: Sources.flags(flags),
      env: Sources.env(env),
      repo: Sources.file(REPO, yield* toml.parse(fileText(files.repo))),
      person: Sources.file(PERSON, yield* toml.parse(fileText(files.person))),
    });
    const snapshot = yield* Snapshot.make(group, resolved);
    return { group, snapshot, rows: Reference.rows(group, snapshot) };
  }).pipe(Effect.provide([TomlParser.layer, Digest.layerWebCrypto]), Effect.runPromise);

/** Whether `line` starts the row of `path`: the path first, then no further key character. */
const starts = (line: string, path: string) => {
  const rest = line.trimStart();
  return rest.startsWith(path) && !/^[a-z0-9.-]/.test(rest.slice(path.length));
};

/** Each shown row's lines, by path, in the order the report prints them. */
const blocks = (report: string, paths: ReadonlyArray<string>) => {
  const out: Array<{ path: string; text: string }> = [];

  for (const line of report.split("\n")) {
    const path = paths.find((p) => starts(line, p));

    if (path !== undefined) {
      out.push({ path, text: line });
    } else if (out.length > 0) {
      out[out.length - 1]!.text += `\n${line}`;
    }
  }

  return out;
};

const collapse = (text: string) => text.replace(/\s+/g, " ").trim();

describe("L5, the printed report says what the snapshot holds, and --all adds only default rows", () => {
  it("shown rows are the explicit ones, or all; each says its value, origin, default and doc", async () => {
    await fc.assert(
      fc.asyncProperty(declared, async (ds) => {
        const { snapshot, rows } = await loadRows(ds);
        const paths = rows.map((r) => r.path);
        const plain = Print.report(rows, { all: false });
        const all = Print.report(rows, { all: true });

        for (const [report, every] of [
          [plain, false],
          [all, true],
        ] as const) {
          const shown = blocks(report, paths);
          // Visibility by origin alone: an explicit value equal to its default still shows.
          const want = rows.filter((r) => every || r.origin._tag !== "default").map((r) => r.path);
          expect(
            shown.map((b) => b.path),
            report,
          ).toEqual(want);

          for (const block of shown) {
            const row = rows.find((r) => r.path === block.path)!;
            const origin = snapshot.origins[row.path]!;
            expect(row.value).toEqual(snapshot.values[row.path]);
            expect(block.text).toContain(String(row.value));
            expect(block.text).toContain(String(row.default));
            expect(collapse(block.text)).toContain(collapse(row.doc));

            if (origin._tag === "file") {
              expect(block.text).toContain(origin.file);
              expect(block.text).toMatch(new RegExp(`(^|\\D)${origin.line}(\\D|$)`));
            }

            if (origin._tag === "flag" || origin._tag === "env") {
              expect(block.text).toContain(origin.name);
            }
          }
        }

        // --all changes visibility only: an explicit row reads the same in both reports. The last
        // row's lines run to the end, so a closing line after it may differ.
        const explicit = (report: string) =>
          blocks(report, paths).filter((b) => rows.find((r) => r.path === b.path)!.origin._tag !== "default");
        const [a, b] = [explicit(all), explicit(plain)];
        expect(a.map((x) => x.path)).toEqual(b.map((x) => x.path));
        a.forEach((x, n) => {
          const [long, short] = [x.text.trimEnd(), b[n]!.text.trimEnd()].sort((p, q) => q.length - p.length);
          expect(long!.startsWith(short!), `${long}\n---\n${short}`).toBe(true);
        });
      }),
      check,
    );
  });
});
