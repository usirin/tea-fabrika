// The plant records a review's brief carries (ticket 850), pure: the lane's state file steps and
// report texts in, the brief's section out. No files, git or agent.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import * as Plants from "./plants.ts";

const options = { seed: 119120, numRuns: 300 };

// Few heads, so a build that left the head where a tests step ended it comes up often.
const sha = fc.constantFrom("a".repeat(40), "b".repeat(40), "c".repeat(40));
const law = fc.constantFrom("L1", "L2", "L3", "A4 failed");

const plant = fc.record({
  law,
  plant: fc.stringMatching(/^[a-z][a-z .:]{0,20}$/),
  result: fc.constantFrom("red" as const, "green" as const),
});

const tests = fc.record({
  step: fc.constant("tests"),
  head: sha,
  report: fc.constant(null),
  plants: fc.array(plant, { minLength: 1, maxLength: 5 }),
});

const other = fc.oneof(
  fc.record({ step: fc.constant("build"), outcome: fc.constantFrom("done", "stuck:no_commit"), head: sha }),
  fc.record({ step: fc.constant("review"), outcome: fc.constant("send:tests:step_said"), head: sha }),
  // A tests step that named no plants, as every entry drive wrote before ticket 850.
  fc.record({ step: fc.constant("tests"), outcome: fc.constant("done"), head: sha }),
);

const steps = fc.array(fc.oneof(tests, other), { maxLength: 10 });
const none = () => null;

// The two real plant tables of 2026-11-11, as the reports wrote them.
const acpcancel = [
  "**Plants** (each one changed only the line named):",
  "",
  "| Law | Plant | What the failure looked like |",
  "|---|---|---|",
  "| L1 | `refusal.ts`: dropped `!cancels.includes` | Failed on the first run: it picked `cancel` |",
  "| L6 | `harness.ts:865`: Codex row gets `cancels: []` | `expected [] to deeply equal ['cancel']` |",
  "",
  "No findings.",
].join("\n");

const sjob1 = [
  "| Law | Plant | Result |",
  "|---|---|---|",
  '| L8 | `init` answers without `ready()` | red: "expected null to be +0" |',
  '| A4 failed | 1. drop the resend on reopen | red: "expected 1 to be +0" |',
  '| A4 failed | 2. clear `pending` early | red: "expected +0 to be 1" |',
  "",
  "| File | Lines |",
  "|---|---|",
  "| L8 | not a plant table |",
].join("\n");

describe("a review's brief carries the lane's plant records, today's tooling", () => {
  // Plants run once, all red: take the oldest answer per law; merge every answer's plants for a
  // law; keep only the first law of each answer.
  it("property: each law's record is the plants of the newest tests answer that named it", () => {
    fc.assert(
      fc.property(steps, (lane) => {
        const found = Plants.records(lane, none);
        const named = lane.flatMap((s) => ("plants" in s ? s.plants.map((p) => p.law) : []));
        expect(found.map((r) => r.law).toSorted()).toEqual([...new Set(named)].toSorted());

        for (const r of found) {
          const newest = lane.findLast((s) => "plants" in s && s.plants.some((p) => p.law === r.law));
          expect(newest).toBeDefined();
          expect(r.head).toBe(newest?.head);
          expect(r.plants).toEqual("plants" in newest! ? newest.plants.filter((p) => p.law === r.law) : []);
        }
      }),
      options,
    );
  });

  // Plants run once, both red: mark every record before any build older; ignore the head.
  it("property: a record is older only when it ran before the last build and that build moved the head", () => {
    fc.assert(
      fc.property(steps, (lane) => {
        const lastBuild = lane.findLastIndex((s) => s.step === "build" && "outcome" in s && s.outcome === "done");

        for (const r of Plants.records(lane, none)) {
          const at = lane.findLastIndex((s) => "plants" in s && s.plants.some((p) => p.law === r.law));
          expect(r.older).toBe(at < lastBuild && r.head !== lane[lastBuild]?.head);
        }
      }),
      options,
    );
  });

  // scenario: the acpcancel and sjob1 reports of 2026-11-11, whose failure text the review needed.
  // Plants run once, both red: read only a `Result` column; read rows of any table.
  it("scenario: the report's failure text is the last cell of the law's rows in a plant table", () => {
    expect(Plants.failuresIn(acpcancel, "L1")).toEqual(["Failed on the first run: it picked `cancel`"]);
    expect(Plants.failuresIn(acpcancel, "L6")).toEqual(["`expected [] to deeply equal ['cancel']`"]);
    expect(Plants.failuresIn(sjob1, "L8")).toEqual(['red: "expected null to be +0"']);
    expect(Plants.failuresIn(sjob1, "A4 failed")).toEqual(['red: "expected 1 to be +0"', 'red: "expected +0 to be 1"']);
    expect(Plants.failuresIn(sjob1, "L2")).toEqual([]);
    expect(Plants.failuresIn("no table here", "L1")).toEqual([]);
  });

  // Plant run once, red: read the report even when the file is gone (the reader gives null).
  it("scenario: a record carries its report's failure text, and none once the report is gone", () => {
    const lane = [
      {
        step: "tests",
        head: "a".repeat(40),
        report: "/boxes/l-tests2.md",
        plants: [{ law: "L1", plant: "x", result: "red" }],
      },
      {
        step: "tests",
        head: "b".repeat(40),
        report: "/boxes/l-tests3.md",
        plants: [{ law: "L6", plant: "y", result: "red" }],
      },
    ];
    const read = (path: string) => (path.endsWith("tests2.md") ? acpcancel : null);
    const [l1, l6] = Plants.records(lane, read);
    expect(l1?.failures).toEqual(["Failed on the first run: it picked `cancel`"]);
    expect(l6?.failures).toEqual([]);
    expect(Plants.section(Plants.records(lane, read), null)).toContain(
      "  - the report's failure: Failed on the first run: it picked `cancel`",
    );
  });

  // Plants run once, all red: leave out the head; leave out the older mark; give a section with none.
  it("property: the section names each record's law, short head, plants and failures, and is null with none", () => {
    fc.assert(
      fc.property(steps, fc.option(sha, { nil: null }), (lane, build) => {
        const found = Plants.records(lane, none);
        const text = Plants.section(found, build);

        if (found.length === 0) {
          expect(text).toBeNull();
          return;
        }

        expect(text).toContain("## Plant records");
        expect(text).toContain(build === null ? "No build has moved the lane yet." : build.slice(0, 8));

        for (const r of found) {
          const line = `- ${r.law}, at ${r.head.slice(0, 8)}${r.older ? ", older than the last build" : ""}:`;
          expect(text).toContain(line);

          for (const p of r.plants) {
            expect(text).toContain(`  - ${p.result}: ${p.plant}`);
          }
        }
      }),
      options,
    );
  });
});
