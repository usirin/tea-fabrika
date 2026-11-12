import { describe, expect, expectTypeOf, it } from "@effect/vitest";
import { Checks } from "@kampus/libfabrika/ci/Ci";
import * as CiTest from "@kampus/libfabrika/ci/CiTest";
import { Path } from "@kampus/libfabrika/codehost/CodeHost";
import { Schema } from "effect";
import * as fc from "fast-check";
import picomatch from "picomatch/posix";
import * as Change from "./Change.ts";
import type { merger } from "./Merger.ts";

const same = (a: { name: string; source?: string }, b: { name: string; source?: string }) =>
  a.name === b.name && a.source === b.source;

const current = fc
  .uniqueArray(CiTest.run, { comparator: same, maxLength: 15 })
  .chain((runs) =>
    fc
      .tuple(CiTest.run, CiTest.run, CiTest.run, CiTest.run)
      .map(([a, b, c, d]) => [
        ...runs.filter(
          (r) =>
            !same(r, { name: "a\u0000b", source: "c" }) &&
            !same(r, { name: "a", source: "b\u0000c" }) &&
            r.name !== "\u0000shared",
        ),
        { ...a, name: "a\u0000b", source: "c" },
        { ...b, name: "a", source: "b\u0000c" },
        { ...c, name: "\u0000shared", source: "\u0000first" },
        { ...d, name: "\u0000shared", source: "\u0000second" },
      ]),
  );

const check = fc
  .record({ name: CiTest.word, source: fc.option(CiTest.word, { nil: undefined }) })
  .map(({ name, source }) => (source === undefined ? { name } : { name, source }));

const normalize = (values: ReadonlyArray<unknown>) => [...new Set(values.map((v) => JSON.stringify(v)))].sort();

const oracle = (checks: ReadonlyArray<typeof Change.Check.Type>, runs: typeof Checks.Type) => {
  const asked = checks.filter((c, i) => !checks.slice(0, i).some((p) => same(p, c)));
  const selected = runs.filter((r) =>
    asked.some((c) => c.name === r.name && (c.source === undefined || c.source === r.source)),
  );
  const red = selected.filter(
    (r) => r.status._tag === "done" && ["failure", "timed_out"].includes(r.status.conclusion),
  );
  const lost = selected.filter(
    (r) => r.status._tag === "done" && ["cancelled", "startup_failure"].includes(r.status.conclusion),
  );
  const pending = asked.filter((c) => {
    const matching = selected.filter((r) => r.name === c.name && (c.source === undefined || c.source === r.source));
    return matching.length === 0 || matching.some((r) => r.status._tag !== "done");
  });
  return red.length > 0
    ? { tag: "red", values: red }
    : lost.length > 0
      ? { tag: "lost", values: lost }
      : pending.length > 0
        ? { tag: "pending", values: pending }
        : { tag: "green", values: selected };
};

describe("L5: the verdict", () => {
  it("requires every named source, deduplicates checks and gives red, lost and pending their priority", () => {
    const cases = current.chain((runs) =>
      fc
        .tuple(
          fc.array(
            fc.oneof(
              check,
              fc
                .constantFrom(...runs)
                .chain((r) =>
                  fc.boolean().map((source) => (source ? { name: r.name, source: r.source } : { name: r.name })),
                ),
            ),
            { minLength: 1, maxLength: 16 },
          ),
          fc.shuffledSubarray(runs, { minLength: runs.length, maxLength: runs.length }),
          CiTest.run,
        )
        .map(([checks, shuffled, extra]) => ({ runs, checks: [checks[0]!, ...checks] as const, shuffled, extra })),
    );
    fc.assert(
      fc.property(cases, ({ checks, runs, shuffled, extra }) => {
        expect(Schema.is(Checks)(runs)).toBe(true);
        const expected = oracle(checks, runs);
        const answer = Change.verdict(checks, runs);
        expect(Schema.is(Change.Verdict)(answer)).toBe(true);
        expect(answer._tag).toBe(expected.tag);
        const values = answer._tag === "pending" ? answer.checks : answer.runs;
        expect(values.length).toBeGreaterThan(0);
        expect(normalize(values)).toEqual(normalize(expected.values));
        const repeated = Change.verdict([...checks, ...checks], shuffled);
        expect(repeated._tag).toBe(answer._tag);
        expect(normalize(repeated._tag === "pending" ? repeated.checks : repeated.runs)).toEqual(normalize(values));
        const unused = { ...extra, name: `${checks.map((c) => c.name).join("")}unused` };
        const added = Change.verdict(checks, [...runs, unused]);
        expect(added._tag).toBe(answer._tag);
        expect(normalize(added._tag === "pending" ? added.checks : added.runs)).toEqual(normalize(values));

        for (const pair of [
          { name: "a\u0000b", source: "c" },
          { name: "a", source: "b\u0000c" },
        ]) {
          const one = Change.verdict([pair], runs);
          const wanted = oracle([pair], runs);
          expect(one._tag).toBe(wanted.tag);
          expect(normalize(one._tag === "pending" ? one.checks : one.runs)).toEqual(normalize(wanted.values));
        }
      }),
      { seed: 119120, numRuns: 500 },
    );
  });
});

const segment = fc.oneof(
  fc.constantFrom(".dot", "a b", "[x]", "a*", "a?", "文"),
  fc.stringMatching(/^[a-z0-9_-]{1,12}$/),
);

const path = fc
  .array(segment, { minLength: 1, maxLength: 5 })
  .map((parts) => Schema.decodeUnknownSync(Path)(parts.join("/")));

const glob = fc
  .oneof(
    fc.string({ unit: "binary", minLength: 1, maxLength: 80 }),
    fc.constantFrom("**", "**/*", "*.md", "docs/**", ".dot/**", "**/[ab]*", "{docs,rows}/**", "**/a\\*"),
  )
  .filter(Schema.is(Change.Glob));

const weight = { rows: 0, docs: 1, code: 2 } as const;

describe("L6: kind is the heaviest", () => {
  it("takes every path and both sets of globs into account, with code for an incomplete list", () => {
    fc.assert(
      fc.property(
        fc.record({ rows: fc.array(glob, { maxLength: 8 }), docs: fc.array(glob, { maxLength: 8 }) }),
        fc.array(path, { maxLength: 18 }),
        path,
        (kinds, paths, added) => {
          const expected =
            paths.length === 0
              ? "code"
              : paths.reduce<"rows" | "docs" | "code">((heavy, p) => {
                  const kind = kinds.docs.some((g) => picomatch(g)(p))
                    ? "docs"
                    : kinds.rows.some((g) => picomatch(g)(p))
                      ? "rows"
                      : "code";
                  return weight[kind] > weight[heavy] ? kind : heavy;
                }, "rows");
          expect(Change.kind(kinds, paths)).toBe(expected);
          expect(Change.kind(kinds, null)).toBe("code");
          expect(Change.kind(kinds, [])).toBe("code");
          expect(
            Change.kind(
              {
                rows: [...kinds.rows].reverse().concat(kinds.rows),
                docs: [...kinds.docs].reverse().concat(kinds.docs),
              },
              [...paths].reverse().concat(paths),
            ),
          ).toBe(expected);

          if (paths.length > 0) {
            expect(weight[Change.kind(kinds, [...paths, added])]).toBeGreaterThanOrEqual(weight[expected]);
          }

          const both = Schema.decodeUnknownSync(Change.Glob)("**");
          expect(Change.kind({ rows: [both], docs: [both] }, [Schema.decodeUnknownSync(Path)("docs/a b.md")])).toBe(
            "docs",
          );
        },
      ),
      { seed: 119120, numRuns: 500 },
    );
  });
});

// L7 is checked by the compiler. No invalid call runs in Vitest.
const emptyIsInvalid = (runs: typeof Checks.Type) => {
  // @ts-expect-error No verdict is defined for an empty check plan.
  Change.verdict([], runs);
};

type Model = ReturnType<typeof merger>["machine"]["model"]["Type"];
type Checking = Extract<Model, { readonly _tag: "checking" }>;
expectTypeOf<readonly []>().not.toExtend<Checking["checks"]>();
void emptyIsInvalid;
