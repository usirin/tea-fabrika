import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Arbitrary, Effect, Schema } from "effect";
import * as fc from "fast-check";
import { expect, it } from "vitest";
import * as checker from "./field-check.ts";

// Today's field records. Covers field-schema.ts and field-check.ts, including added-row
// selection, optional facts, advisory drift and annotations. No network or real rows.
// T342 source plants, all caught: set-like selection, checking the whole head,
// blocking README enums, accepting bad counts, failing on advice, row text in an
// annotation, and treating failed history reads as empty successful input.
const options = { seed: 119120, numRuns: 100 };
const schemaOptions = { seed: 119120, runs: 100 };
// Type-law plants are compiled by the final workspace typecheck. Each directive
// itself fails if the installed API or the checked result stops refusing the plant.
// @ts-expect-error Effect 4.1.2 has no Schema.notAnInstalledApi.
type UnsupportedSchemaApi = typeof Schema.notAnInstalledApi;

const typePlants = (_unsupported: UnsupportedSchemaApi, _report: ReturnType<typeof checker.checkFile>) => {};

// @ts-expect-error An unchecked success is missing findings, annotations and added count.
typePlants(undefined, { exitCode: 0 });
const Text = Schema.NullOr(Schema.String);
const Count = Schema.NullOr(Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0)));

// Independent contract schemas keep the input generator from weakening with a decoder.
const Note = Schema.Struct({
  id: Schema.String,
  date: Schema.String.check(Schema.isPattern(/^\d{4}-\d{2}-\d{2}$/)),
  stage: Schema.String,
  kind: Schema.String,
  what: Schema.String,
  lanes: Schema.Array(Schema.Unknown),
  fix: Text,
  cause: Schema.optionalKey(Text),
  person: Schema.optionalKey(Schema.Boolean),
  primitive: Schema.optionalKey(Text),
  test: Schema.optionalKey(Text),
  links: Schema.optionalKey(Schema.Array(Schema.String)),
});

const Run = Schema.Struct({
  date: Schema.String.check(Schema.isPattern(/^\d{4}-\d{2}-\d{2}$/)),
  role: Schema.String,
  model: Text,
  effort: Text,
  outcome: Text,
  note: Text,
  why: Text,
  tokens: Count,
  tools: Count,
  minutes: Count,
  run: Schema.optionalKey(Schema.String),
  started: Schema.optionalKey(Text),
  ended: Schema.optionalKey(Text),
  parent: Schema.optionalKey(Text),
  active: Schema.optionalKey(Count),
  costUsd: Schema.optionalKey(Count),
  listUsd: Schema.optionalKey(Count),
  billed: Schema.optionalKey(Count),
  inputTokens: Schema.optionalKey(Count),
  cachedTokens: Schema.optionalKey(Count),
  outputTokens: Schema.optionalKey(Count),
  driver_caused: Schema.optionalKey(Schema.Boolean),
});

const noteFields = [
  "id",
  "date",
  "stage",
  "kind",
  "what",
  "lanes",
  "fix",
  "cause",
  "person",
  "primitive",
  "test",
  "links",
];

const runFields = [
  "date",
  "role",
  "model",
  "effort",
  "outcome",
  "note",
  "why",
  "tokens",
  "tools",
  "minutes",
  "run",
  "started",
  "ended",
  "parent",
  "active",
  "costUsd",
  "listUsd",
  "billed",
  "inputTokens",
  "cachedTokens",
  "outputTokens",
  "driver_caused",
];

// Decision 0090: a new row is its own file, named by its date and a slug, and that name is its id.
const named = "2026-11-11-a-row";
const fileOf = (log: "notes" | "runs" | "findings") => `field/${log}/${named}.json`;
/** A generated row with its own id set to the file name, as a writer saves it. */
const own = <A extends object>(row: A, key: "id" | "run"): A => ({ ...row, [key]: named });

it("added rows preserve occurrence counts and head line numbers", () => {
  const line = fc.string({ maxLength: 24 }).map((s) => JSON.stringify(s));
  fc.assert(
    fc.property(fc.array(line, { maxLength: 15 }), fc.array(line, { minLength: 1, maxLength: 15 }), (base, extra) => {
      const head = [...base.toReversed(), ...extra, ...(base.length ? [base[0]!] : [])];
      const remaining = [...base];
      const expected = head.flatMap((text, i) => {
        const old = remaining.indexOf(text);

        if (old < 0) {
          return [{ line: i + 1, text }];
        }

        remaining.splice(old, 1);
        return [];
      });
      expect(checker.selectAdded(base.length ? `${base.join("\n")}\n` : "", `${head.join("\n")}\n`)).toEqual(expected);
      expect(checker.selectAdded("", "\n")).toEqual([{ line: 1, text: "" }]);
      expect(checker.selectAdded(`${head.join("\n")}\n`, `${head.join("\n")}\n`)).toEqual([]);
    }),
    options,
  );
});

it("a push keeps its two event trees and refuses failed diff, tree or blob reads", () => {
  fc.assert(
    fc.property(fc.string(), fc.string(), fc.boolean(), fc.boolean(), (baseText, headText, existed, remains) => {
      const base = "b".repeat(40),
        head = "c".repeat(40),
        file = "field/notes.jsonl";
      const calls: string[][] = [];
      const run = (args: string[]) => {
        calls.push(args);
        const stdout =
          args[0] === "diff"
            ? `${file}\0`
            : args[0] === "ls-tree"
              ? (args[4] === base ? existed : remains)
                ? `${file}\0`
                : ""
              : args[1]?.startsWith(base)
                ? baseText
                : headText;
        return { status: 0, stdout };
      };
      expect(checker.readFieldFiles(base, head, "push", run)).toEqual([
        { file, base: existed ? baseText : "", head: remains ? headText : "" },
      ]);
      expect(calls.some((args) => args[0] === "merge-base")).toBe(false);
      const reads = calls.length;

      for (let at = 0; at < reads; at++) {
        let i = 0;
        expect(() =>
          checker.readFieldFiles(base, head, "push", (args) => (i++ === at ? { status: 128, stdout: "" } : run(args))),
        ).toThrow();
      }
    }),
    options,
  );
});

// Plan change, 2026-11-09: field-check reads a PR's rows from the merge base, as changes.mjs
// reads its paths. Plant caught: diffing the event's base SHA (main's tip), which counts main's
// newer rows and edits against the PR and shows a field file the PR never touched.
const gitEnv = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" };

const gitIn =
  (dir: string) =>
  (args: string[]): { status: number | null; stdout: string } =>
    spawnSync(
      "git",
      ["-C", dir, "-c", "user.name=t", "-c", "user.email=t@t", "-c", "core.hooksPath=/dev/null", ...args],
      { encoding: "utf8", env: gitEnv },
    );

const text = (rows: readonly string[]) => rows.map((row) => `${row}\n`).join("");

it("a PR's field rows compare to the merge base while main moves ahead", () => {
  const row = fc.stringMatching(/^[ -~]{0,20}$/);
  fc.assert(
    fc.property(
      fc.array(row, { maxLength: 6 }),
      fc.array(row, { maxLength: 4 }),
      fc.array(row, { minLength: 1, maxLength: 4 }),
      fc.boolean(),
      fc.boolean(),
      (fork, mine, theirs, dropFirst, notesToo) => {
        const dir = mkdtempSync(join(tmpdir(), "ci-field-"));

        try {
          const git = gitIn(dir);
          const commit = (files: Record<string, string>, message: string) => {
            for (const [file, body] of Object.entries(files)) {
              mkdirSync(dirname(join(dir, file)), { recursive: true });
              writeFileSync(join(dir, file), body);
            }

            expect(git(["add", "-A"]).status).toBe(0);
            expect(git(["commit", "-q", "--allow-empty", "-m", message]).status).toBe(0);
            return git(["rev-parse", "HEAD"]).stdout.trim();
          };
          expect(git(["init", "-q", "-b", "main"]).status).toBe(0);
          const runs = "field/runs.jsonl";
          commit({ [runs]: text(fork), "field/notes.jsonl": "", "docs/a.md": "" }, "fork");
          expect(git(["checkout", "-q", "-b", "pr"]).status).toBe(0);
          const head = commit(mine.length > 0 ? { [runs]: text([...fork, ...mine]) } : { "docs/a.md": "pr\n" }, "pr");
          expect(git(["checkout", "-q", "main"]).status).toBe(0);
          const ahead = [...(dropFirst ? fork.slice(1) : fork), ...theirs];
          const base = commit(
            { [runs]: text(ahead), ...(notesToo ? { "field/notes.jsonl": text(theirs) } : {}) },
            "main moves ahead",
          );
          const files = checker.readFieldFiles(base, head, "pull_request", git);
          expect(files).toEqual(
            mine.length > 0 ? [{ file: runs, base: text(fork), head: text([...fork, ...mine]) }] : [],
          );

          for (const input of files) {
            expect(checker.selectAdded(input.base, input.head).map((added) => added.text)).toEqual(mine);
          }
        } finally {
          rmSync(dir, { recursive: true, force: true });
        }
      },
    ),
    { ...options, numRuns: 25 },
  );
});

// Plan change, 2026-11-09: `note` stays optional for rows written before the change. 111 rows
// in field/runs.jsonl, dated 2026-10-23 to 2026-10-27, have no `note`. Plant caught: `note`
// as a required core, which fails each such row when a PR edits or moves it.
it("a run row written before the plan change passes without note", () => {
  const daysBack = Arbitrary.schema(Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 4000 })));
  const result = Effect.runSync(
    Arbitrary.checkEffect(
      Arbitrary.all([Arbitrary.schema(Run), daysBack]),
      ([row, back]) => {
        const date = new Date(Date.UTC(2026, 10, 8) - back * 86_400_000).toISOString().slice(0, 10);
        const old = Object.fromEntries(Object.entries(own({ ...row, date }, "run")).filter(([key]) => key !== "note"));
        const report = checker.checkFile(fileOf("runs"), "", `${JSON.stringify(old)}\n`);
        return report.exitCode === 0 && report.findings.every((f) => f._tag !== "error") && report.added === 1;
      },
      schemaOptions,
    ),
  );
  expect(result._tag).toBe("Passed");
});

it("valid cores pass, each blocking field rejects bad types, optional facts stay unknown", () => {
  for (const [schema, file, fields, key] of [
    [Note, fileOf("notes"), noteFields, "id"],
    [Run, fileOf("runs"), runFields, "run"],
  ] as const) {
    const result = Effect.runSync(
      Arbitrary.checkEffect(
        Arbitrary.map(Arbitrary.schema(schema), (row) => own(row, key)),
        (row) => {
          const text = JSON.stringify({ ...row, extra: { future: true }, ticket: 342, pr: null });
          const good = checker.checkFile(file, "", `${text}\n`);
          const broken = fields.every((field) => {
            const bad = checker.checkFile(file, "", `${JSON.stringify({ ...row, [field]: { bad: true } })}\n`);
            return bad.exitCode !== 0 && bad.findings.some((f) => f._tag === "error" && f.field === field);
          });
          const required =
            key === "id"
              ? ["id", "date", "stage", "kind", "what", "lanes", "fix"]
              : [
                  "date",
                  "role",
                  "model",
                  "effort",
                  "outcome",
                  // `note` is optional for rows written before the plan change.
                  "why",
                  "tokens",
                  "tools",
                  "minutes",
                ];
          const missing = required.every(
            (field) =>
              checker.checkFile(
                file,
                "",
                JSON.stringify(Object.fromEntries(Object.entries(row).filter(([key]) => key !== field))),
              ).exitCode !== 0,
          );
          return good.exitCode === 0 && good.added === 1 && broken && missing;
        },
        schemaOptions,
      ),
    );
    expect(result._tag).toBe("Passed");
  }
});

it("negative and nonfinite counts, missing cores and wrong dates fail without coercion", () => {
  const result = Effect.runSync(
    Arbitrary.checkEffect(
      Arbitrary.map(Arbitrary.schema(Run), (row) => own(row, "run")),
      (row) => {
        const errors = [
          ...[
            "tokens",
            "tools",
            "minutes",
            "active",
            "costUsd",
            "listUsd",
            "billed",
            "inputTokens",
            "cachedTokens",
            "outputTokens",
          ].flatMap((field) => [-1, "0", true].map((bad) => ({ ...row, [field]: bad }))),
          ...Object.keys(Run.fields)
            .slice(0, 10)
            // `note` is optional for rows written before the plan change.
            .filter((field) => field !== "note")
            .map((field) => Object.fromEntries(Object.entries(row).filter(([key]) => key !== field))),
          { ...row, date: "yesterday" },
        ];
        return (
          errors.every((bad) => checker.checkFile(fileOf("runs"), "", `${JSON.stringify(bad)}\n`).exitCode !== 0) &&
          checker.checkFile(fileOf("runs"), "", JSON.stringify(row).replace(/"tokens":[^,}]*/, '"tokens":1e999'))
            .exitCode !== 0
        );
      },
      schemaOptions,
    ),
  );
  expect(result._tag).toBe("Passed");
});

it("advice warns with exit zero; errors identify head lines without row content", () => {
  fc.assert(
    fc.property(fc.integer({ min: 1, max: 12 }), fc.string({ minLength: 1, maxLength: 30 }), (old, payload) => {
      const base = `${Array.from({ length: old }, () => "old malformed row").join("\n")}\n`;
      const marker = `private-${JSON.stringify(payload)}-end\r\n%`;
      const row = {
        id: named,
        date: "2026-99-99",
        stage: "new-stage",
        kind: "new-kind",
        what: marker,
        lanes: [42],
        fix: null,
      };
      const report = checker.checkFile(fileOf("notes"), "", JSON.stringify(row));
      expect(report.exitCode).toBe(0);
      expect(report.added).toBe(1);
      expect(report.findings.some((f) => f._tag === "warning")).toBe(true);
      expect(report.findings.every((f) => f.line === 1 && f.file === fileOf("notes"))).toBe(true);
      const bad = checker.checkFile(fileOf("notes"), "", JSON.stringify({ ...row, what: 42 }));
      expect(bad.exitCode).not.toBe(0);
      expect(bad.findings.some((f) => f._tag === "error" && f.line === 1 && f.field === "what")).toBe(true);
      // An old log names the head line of each line added to it, never the line's text.
      const history = checker.checkFile("field/notes.jsonl", base, `${base}${JSON.stringify(row)}\n${marker}\n`);
      expect(history.exitCode).not.toBe(0);
      expect(history.findings.length).toBeGreaterThanOrEqual(2);
      expect(history.findings[0]?.line).toBe(old + 1);
      expect(history.findings.every((f) => f._tag === "error" && f.field === "row" && f.line > old)).toBe(true);

      for (const annotation of [...report.annotations, ...bad.annotations, ...history.annotations]) {
        expect(annotation).not.toContain(marker);
        expect(annotation).not.toContain(payload.length > 5 ? payload : marker);
        expect(annotation).not.toMatch(/[\r\n]/);
      }

      const unknown = checker.checkFile("field/future.jsonl", "", `${JSON.stringify({ text: marker })}\n`);
      expect(unknown.exitCode).toBe(0);
      expect(unknown.findings.some((f) => f._tag === "warning")).toBe(true);

      for (const text of ["null", "[]", '"text"', "1", "{", "\n"]) {
        expect(checker.checkFile("field/future.jsonl", "", text).exitCode).not.toBe(0);
      }
    }),
    options,
  );
});

// Ticket 523, decision 0035: a finding row's core blocks. Independent contract schemas, as above.
// Plants caught: no schema for findings.jsonl (every bad row passed with a warning), an open
// `rule`, `at` let through beside `location`, and an empty proof.
const Words = Schema.String.check(Schema.isPattern(/\S/));

const rules = ["bug", "dead_code", "duplicate", "missing_test", "flaky_test", "doc_drift", "rule_break"];

const Found = Schema.Struct({
  _tag: Schema.Literal("finding"),
  id: Schema.String,
  date: Schema.String.check(Schema.isPattern(/^\d{4}-\d{2}-\d{2}$/)),
  by: Words,
  model: Text,
  rule: Schema.Literals(rules),
  location: Schema.Struct({
    path: Words,
    line: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 100_000 })),
  }),
  says: Words,
  proof: Words,
  cost: Words,
  head: Schema.String,
  ticket: Text,
  pr: Text,
});

const Rated = Schema.Struct({
  _tag: Schema.Literal("rated"),
  finding: Schema.String,
  says: Schema.Literals(["fix", "noise"]),
  by: Words,
  date: Schema.String.check(Schema.isPattern(/^\d{4}-\d{2}-\d{2}$/)),
  ticket: Text,
});

const errorsOf = (row: unknown) => {
  const report = checker.checkFile(fileOf("findings"), "", `${JSON.stringify(row)}\n`);
  return {
    exitCode: report.exitCode,
    fields: report.findings.filter((f) => f._tag === "error").map((f) => f.field),
  };
};

const without = (row: object, field: string) =>
  Object.fromEntries(Object.entries(row).filter(([key]) => key !== field));

it("a finding or rated row passes whole, and each core field blocks when wrong or missing", () => {
  for (const schema of [Found, Rated]) {
    const result = Effect.runSync(
      Arbitrary.checkEffect(
        // A rating has no id of its own: its file name is enough.
        Arbitrary.map(Arbitrary.schema(schema), (row) => ("id" in row ? own(row, "id") : row)),
        (row) => {
          const good = errorsOf({ ...row, extra: { future: true } });
          const each = Object.keys(schema.fields).every((field) => {
            const bad = errorsOf({ ...row, [field]: { bad: true } });
            const gone = errorsOf(without(row, field));
            // A row with no readable `_tag` is refused as a whole.
            const named = field === "_tag" ? "_tag" : field;
            return (
              bad.exitCode !== 0 && bad.fields.includes(named) && gone.exitCode !== 0 && gone.fields.includes(named)
            );
          });
          return good.exitCode === 0 && good.fields.length === 0 && each;
        },
        schemaOptions,
      ),
    );
    expect(result._tag).toBe("Passed");
  }
});

it("a finding blocks on a rule outside the closed list, on `at`, and on empty proof", () => {
  const blank = Arbitrary.schema(Schema.String.check(Schema.isPattern(/^[ \t\n]*$/)));
  const result = Effect.runSync(
    Arbitrary.checkEffect(
      Arbitrary.all([
        Arbitrary.map(Arbitrary.schema(Found), (row) => own(row, "id")),
        Arbitrary.schema(Schema.String),
        blank,
      ]),
      ([row, word, empty]) => {
        const open = rules.includes(word) ? `${word}_` : word;
        const place = errorsOf({ ...without(row, "location"), at: row.location });
        return (
          errorsOf({ ...row, rule: open }).fields.includes("rule") &&
          errorsOf({ ...row, at: row.location }).fields.includes("at") &&
          place.fields.includes("at") &&
          place.fields.includes("location") &&
          ["says", "proof", "cost", "by"].every((field) =>
            errorsOf({ ...row, [field]: empty }).fields.includes(field),
          ) &&
          [0, -1, 1.5, "3", null].every((line) =>
            errorsOf({ ...row, location: { ...row.location, line } }).fields.includes("location"),
          ) &&
          errorsOf({ ...row, location: { line: row.location.line, path: empty } }).fields.includes("location") &&
          errorsOf({ ...row, _tag: word }).fields.includes("_tag") &&
          errorsOf({ ...row, says: "fix", _tag: "rated" }).exitCode !== 0
        );
      },
      schemaOptions,
    ),
  );
  expect(result._tag).toBe("Passed");
});

it("a finding's unusual sha, references and path, and a rating's unusual finding, only warn", () => {
  const result = Effect.runSync(
    Arbitrary.checkEffect(
      Arbitrary.all([Arbitrary.map(Arbitrary.schema(Found), (row) => own(row, "id")), Arbitrary.schema(Rated)]),
      ([row, rated]) => {
        const marker = `private-${JSON.stringify(row.proof)}-end`;
        const odd = {
          ...row,
          says: marker,
          proof: marker,
          cost: marker,
          head: `${row.head}z`,
          ticket: "497",
          pr: "pull 703",
          location: { ...row.location, path: `/${row.location.path}` },
        };
        const found = checker.checkFile(fileOf("findings"), "", JSON.stringify(odd));
        const rating = checker.checkFile(fileOf("findings"), "", JSON.stringify({ ...rated, finding: `id ${row.id}` }));
        // A rating may point at an old counter id or a new file's name.
        const pointed = ["2026-11-10-f36", named].map((finding) =>
          checker.checkFile(fileOf("findings"), "", JSON.stringify({ ...rated, finding, date: "2026-11-11" })),
        );
        const warned = (report: typeof found) => report.findings.map((f) => f.field);
        return (
          [found, rating].every((report) => report.exitCode === 0 && report.added === 1) &&
          [...found.findings, ...rating.findings].every((f) => f._tag === "warning") &&
          ["head", "ticket", "pr", "location"].every((field) => warned(found).includes(field)) &&
          warned(rating).includes("finding") &&
          pointed.every((report) => report.exitCode === 0 && !warned(report).includes("finding")) &&
          found.annotations.every((a) => !a.includes(marker))
        );
      },
      schemaOptions,
    ),
  );
  expect(result._tag).toBe("Passed");
});

// Decision 0090, ticket 562: the three old logs are history, and a new row is its own file.
// Plants caught: an appended line passing its row checks, a misnamed file passing, an id that
// differs from the file name passing, and an edited or deleted row file passing.
const oldLog = fc.constantFrom("notes", "runs", "findings");
const plain = fc.stringMatching(/^[ -~]{0,20}$/);

it("every line added to an old log fails at its head line, and an untouched one passes", () => {
  fc.assert(
    fc.property(
      oldLog,
      fc.array(plain, { maxLength: 8 }),
      fc.array(plain, { minLength: 1, maxLength: 4 }),
      (log, base, extra) => {
        const file = `field/${log}.jsonl`;
        const report = checker.checkFile(file, text(base), text([...base, ...extra]));
        expect(report.exitCode).toBe(1);
        expect(report.added).toBe(extra.length);
        expect(report.findings.map((f) => [f._tag, f.field, f.line])).toEqual(
          extra.map((_, i) => ["error", "row", base.length + i + 1]),
        );
        expect(report.annotations.every((a) => a.includes(`field/${log}/<date>-<slug>.json`))).toBe(true);
        expect(checker.checkFile(file, text(base), text(base))).toMatchObject({ exitCode: 0, added: 0, findings: [] });
      },
    ),
    options,
  );
});

const slug = Arbitrary.schema(Schema.String.check(Schema.isPattern(/^[a-z0-9]{1,8}(?:-[a-z0-9]{1,8}){0,3}$/)));

it("a row file is named by its date and a slug, and its id is that name", () => {
  const result = Effect.runSync(
    Arbitrary.checkEffect(
      Arbitrary.all([Arbitrary.schema(Note), Arbitrary.schema(Run), slug]),
      ([note, run, name]) => {
        const stem = `2026-11-11-${name}`;
        const errors = (file: string, row: object) =>
          checker
            .checkFile(file, "", JSON.stringify(row))
            .findings.filter((f) => f._tag === "error")
            .map((f) => f.field);
        const good = [
          errors(`field/notes/${stem}.json`, { ...note, id: stem }),
          errors(`field/runs/${stem}.json`, { ...run, run: stem }),
        ];
        const misnamed = [
          `field/notes/${name}.json`,
          `field/notes/${stem}X.json`,
          `field/notes/${stem}.jsonl`,
          `field/notes/${stem}`,
          `field/notes/2026-11/${stem}.json`,
          `field/notes/2026-11-11_${name}.json`,
        ].map((file) => errors(file, { ...note, id: stem }));
        return (
          good.every((fields) => fields.length === 0) &&
          misnamed.every((fields) => fields.includes("file")) &&
          errors(`field/notes/${stem}.json`, { ...note, id: `${stem}-x` }).includes("id") &&
          errors(`field/runs/${stem}.json`, { ...run, run: `${stem}-x` }).includes("run") &&
          errors(`field/runs/${stem}.json`, without(run, "run")).includes("run")
        );
      },
      schemaOptions,
    ),
  );
  expect(result._tag).toBe("Passed");
});

it("a row file is never edited or deleted", () => {
  // The new text is a good row, so only the rule against changing a row can fail it.
  const good = JSON.stringify({
    id: named,
    date: "2026-11-11",
    stage: "harness",
    kind: "success",
    what: "w",
    lanes: [],
    fix: null,
  });
  fc.assert(
    fc.property(fc.string({ minLength: 1 }), fc.boolean(), (base, deleted) => {
      fc.pre(base !== good);
      const report = checker.checkFile(fileOf("notes"), base, deleted ? "" : good);
      expect(report.exitCode).toBe(1);
      expect(report.findings.filter((f) => f._tag === "error").map((f) => f.field)).toEqual(["row"]);
      expect(checker.checkFile(fileOf("notes"), "", good).exitCode).toBe(0);
    }),
    options,
  );
});

// vector: which changed paths the field job reads. Old direct .jsonl files and anything in a
// log's folder, so a misnamed row file is read and fails; nothing else in field/.
it("the field job reads the old logs and every path in a log's folder", () => {
  const vectors: Array<[string, boolean]> = [
    ["field/runs.jsonl", true],
    ["field/future.jsonl", true],
    ["field/runs/2026-11-11-t562-tests1.json", true],
    ["field/findings/2026-11-11-a.json", true],
    ["field/notes/misnamed.txt", true],
    ["field/notes/2026-11/2026-11-11-a.json", true],
    ["field/README.md", false],
    ["field/other/2026-11-11-a.json", false],
    ["field/nested/a.jsonl", false],
    ["tools/field/runs/2026-11-11-a.json", false],
  ];
  const paths = vectors.map(([path]) => path);
  const base = "b".repeat(40),
    head = "c".repeat(40);
  const run = (args: string[]) => ({
    status: 0,
    stdout:
      args[0] === "diff"
        ? `${paths.join("\0")}\0`
        : args[0] === "ls-tree"
          ? args[4] === head
            ? `${paths.join("\0")}\0`
            : ""
          : "{}",
  });
  expect(checker.readFieldFiles(base, head, "push", run).map((input) => input.file)).toEqual(
    vectors.filter(([, read]) => read).map(([path]) => path),
  );
});

// scenario: lead's real-PR proof, deliberately not a network-dependent local test.
// Open a field-only PR on this branch. Record both PR URLs/SHAs and the Actions URL.
// Show changes + skills + tracked-file scans pass; check/next/e2e/all six shards skip
// without runners; field starts independently and validates only new rows. Plant an
// invalid row and see field fail, then fix it; advisory drift must warn with exit 0.
// Close the proof PR. Its non-main base means commits does not run: no 44 s claim.
// The implementation PR must pass commits and every heavy job, show no next files in
// today's shards, retain every next test, and record setup/install/test/wall timings.
