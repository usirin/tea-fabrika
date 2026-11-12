import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import * as fc from "fast-check";
import { expect, it } from "vitest";
import { gated, judge } from "./required.mjs";

// Today's CI for both versions. Covers required.mjs, the `ci-required` job's verdict. Each law
// names the edge case it holds from the list at the top of required.mjs.
const options = { seed: 119120, numRuns: 100 };

type Job = { result?: unknown; outputs?: Record<string, unknown> };

const ungated = fc.constantFrom("changes", "field", "lint", "extra-job");
const bad = fc.constantFrom("failure", "cancelled", "", "neutral", undefined, 1);
const flag = fc.constantFrom("true", "false", "", undefined);
const result = fc.constantFrom("success", "skipped", "failure", "cancelled", "");

// A workflow's needs where every job passed; gated jobs skip when their flag is "false".
const green = fc.tuple(...gated.map(() => fc.constantFrom("true", "false"))).map((flags) => {
  const outputs = Object.fromEntries(gated.map((name, i) => [name, flags[i]]));
  const needs: Record<string, Job> = {
    changes: { result: "success", outputs: { ...outputs, field: "true" } },
    field: { result: "success", outputs: {} },
  };

  for (const name of gated) {
    needs[name] = { result: outputs[name] === "false" ? "skipped" : "success", outputs: {} };
  }

  return needs;
});

it("1, 9: every job success passes, whatever changes said, and each needs entry gets one line", () => {
  fc.assert(
    fc.property(green, (needs) => {
      for (const job of Object.values(needs)) {
        job.result = "success";
      }

      const verdict = judge(needs);
      expect(verdict.pass).toBe(true);
      expect(verdict.lines).toHaveLength(Object.keys(needs).length);
    }),
    options,
  );
});

it("2, 3, 4: a gated skip passes only when changes succeeded and said exactly false", () => {
  fc.assert(
    fc.property(
      green,
      fc.constantFrom(...gated),
      flag,
      fc.constantFrom("success", "failure", "cancelled", "skipped"),
      (needs, name, said, changes) => {
        needs["changes"]!.result = changes;
        needs["changes"]!.outputs![name] = said;
        needs[name]!.result = "skipped";
        const others = gated.filter((other) => other !== name && needs[other]!.result === "skipped");
        const meant = (job: string) => changes === "success" && needs["changes"]!.outputs![job] === "false";
        const expected = changes === "success" && meant(name) && others.every(meant);
        expect(judge(needs).pass).toBe(expected);
      },
    ),
    options,
  );
});

it("5: an ungated job that skipped fails, even when changes has an output of its name", () => {
  fc.assert(
    fc.property(green, ungated, (needs, name) => {
      needs["changes"]!.outputs![name] = "false";
      needs[name] = { result: "skipped", outputs: {} };
      const verdict = judge(needs);
      expect(verdict.pass).toBe(false);
      expect(verdict.lines).toContain(`${name}: skipped, but it should have run, fail`);
    }),
    options,
  );
});

it("6: a failed, cancelled, empty or unknown result fails, whatever the output says", () => {
  fc.assert(
    fc.property(green, fc.constantFrom("changes", "field", ...gated), bad, flag, (needs, name, value, said) => {
      needs["changes"]!.outputs![name] = said;
      needs[name]!.result = value;
      expect(judge(needs).pass).toBe(false);
    }),
    options,
  );
});

it("7: changes or a gated job missing from needs fails, and is named", () => {
  fc.assert(
    fc.property(green, fc.constantFrom("changes", ...gated), (needs, name) => {
      delete needs[name];
      const verdict = judge(needs);
      expect(verdict.pass).toBe(false);
      expect(verdict.lines).toContain(`${name}: not in needs, fail`);
    }),
    options,
  );
});

it("the verdict passes exactly when every job passes on its own", () => {
  // An oracle written apart from the judge: random results and flags for every job.
  fc.assert(
    fc.property(
      fc.record({ changes: result, field: result }),
      fc.tuple(...gated.map(() => fc.tuple(result, flag))),
      (top, rows) => {
        const outputs = Object.fromEntries(gated.map((name, i) => [name, rows[i]![1]]));
        const needs: Record<string, Job> = {
          changes: { result: top.changes, outputs },
          field: { result: top.field },
          ...Object.fromEntries(gated.map((name, i) => [name, { result: rows[i]![0] }])),
        };
        const passes = (name: string) =>
          needs[name]!.result === "success" ||
          (needs[name]!.result === "skipped" &&
            (gated as readonly string[]).includes(name) &&
            top.changes === "success" &&
            outputs[name] === "false");
        expect(judge(needs).pass).toBe(Object.keys(needs).every(passes));
      },
    ),
    options,
  );
});

it.each([null, undefined, [], {}, "success", 0, [{ result: "success" }]])("vector: needs %j cannot pass", (needs) => {
  expect(judge(needs).pass).toBe(false);
});

it("scenario: the main reads NEEDS from env, prints one line per job and exits 1 on a fail", () => {
  const script = fileURLToPath(new URL("./required.mjs", import.meta.url));
  const run = (needs: string | undefined) =>
    spawnSync(process.execPath, [script], { encoding: "utf8", env: needs === undefined ? {} : { NEEDS: needs } });
  const good = JSON.stringify({
    changes: {
      result: "success",
      outputs: { check: "false", typecheck: "false", test: "true", next: "true", e2e: "true" },
    },
    field: { result: "success", outputs: {} },
    check: { result: "skipped", outputs: {} },
    typecheck: { result: "skipped", outputs: {} },
    test: { result: "success", outputs: {} },
    next: { result: "success", outputs: {} },
    e2e: { result: "success", outputs: {} },
  });
  const ok = run(good);
  expect(ok.status).toBe(0);
  expect(ok.stdout).toContain("check: skipped, as changes said, pass\n");
  expect(ok.stdout).toContain("typecheck: skipped, as changes said, pass\n");
  expect(ok.stdout.trim().split("\n")).toHaveLength(8);
  expect(run(good.replace('"test":{"result":"success"', '"test":{"result":"failure"')).status).toBe(1);
  expect(run("{not json").status).toBe(1);
  expect(run(undefined).status).toBe(1);
});
