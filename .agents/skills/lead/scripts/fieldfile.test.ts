import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Result } from "effect";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { plan, saved } from "./fieldfile.ts";

// Today's lead tooling. Decision 0090: each new field row is its own file, named by its id.
// Plants caught: a run row saved under its undated lane id, a rating saved under the finding's
// name, a counter id let through, two rows of one name both planned, and a clash that writes
// the rows before it.
const options = { seed: 119120, numRuns: 100 };
const word = fc.stringMatching(/^[a-z0-9]{1,8}$/);
const slug = fc.array(word, { minLength: 1, maxLength: 4 }).map((words) => words.join("-"));

const day = fc
  .integer({ min: 0, max: 3000 })
  .map((n) => new Date(Date.UTC(2026, 10, 11) - n * 86_400_000).toISOString().slice(0, 10));

describe("fieldfile, today's lead tooling", () => {
  it("a row is saved under its own id, and a lane's run id gets the row's date in front", () => {
    fc.assert(
      fc.property(day, slug, (date, name) => {
        const id = `${date}-${name}`;
        const note = saved("notes", { id, date });
        const finding = saved("findings", { _tag: "finding", id, date });
        const dated = saved("runs", { run: id, date });
        const lane = saved("runs", { run: name, date, role: "hand" });
        const rating = saved("findings", { _tag: "rated", finding: id, date });
        expect([note, finding, dated].map((exit) => Result.isSuccess(exit) && exit.success.name)).toEqual([id, id, id]);
        // A lane's run id such as `t562-tests1` is also the slug of the file the row lands in.
        expect(lane).toEqual(Result.succeed({ name: id, row: { run: id, date, role: "hand" } }));
        expect(Result.isSuccess(rating) && rating.success.name).toBe(`${date}-rated-${id}`);
      }),
      options,
    );
  });

  it("a note or finding without a dated slug, or a row of no known shape, is refused", () => {
    fc.assert(
      fc.property(day, slug, fc.string(), (date, name, odd) => {
        const bad = [
          saved("notes", { id: name, date }),
          saved("notes", { id: `${date}-${name}X`, date }),
          saved("notes", { date }),
          saved("findings", { _tag: "finding", id: `${date}_${name}`, date }),
          saved("findings", { _tag: odd === "finding" || odd === "rated" ? `${odd}x` : odd, id: `${date}-${name}` }),
          saved("findings", { _tag: "rated", finding: `${date}-${name}` }),
          saved("runs", { run: name }),
          saved("runs", { date, run: `${name} ${name}` }),
        ];
        expect(bad.map((result) => Result.isFailure(result))).toEqual(bad.map(() => true));
      }),
      options,
    );
  });

  it("a rows text plans every row, or refuses at the first bad or repeated one", () => {
    fc.assert(
      fc.property(day, fc.uniqueArray(slug, { minLength: 2, maxLength: 6 }), (date, names) => {
        const rows = names.map((name) => JSON.stringify({ id: `${date}-${name}`, date }));
        const good = plan("notes", `${rows.join("\n")}\n\n`);
        expect(Result.isSuccess(good) && good.success.map((file) => file.name)).toEqual(
          names.map((name) => `${date}-${name}`),
        );
        expect(Result.isFailure(plan("notes", [...rows, rows[0]].join("\n")))).toBe(true);
        expect(Result.isFailure(plan("notes", [...rows, "{"].join("\n")))).toBe(true);
        expect(Result.isFailure(plan("notes", [...rows, "[]"].join("\n")))).toBe(true);
      }),
      options,
    );
  });

  // scenario: the script on a scratch repo. It writes each row as its file and prints each path;
  // on a clash it writes nothing and exits 1; outside a repo top it refuses.
  it("scenario: writes one file per row, and on a clash writes none", () => {
    const dir = mkdtempSync(join(tmpdir(), "ff-"));
    const script = join(import.meta.dirname, "fieldfile.ts");
    const fieldfile = (...args: string[]) =>
      spawnSync(process.execPath, [script, ...args], {
        cwd: dir,
        encoding: "utf8",
        env: { ...process.env, TYPESAFE_API_KEY: undefined },
      });

    try {
      const rows = join(dir, "rows.jsonl");
      const step = { date: "2026-11-11", run: "t562-tests1", role: "hand", step: "tests" };
      const pipeline = { date: "2026-11-11", run: "2026-11-11-t562-lane", role: "pipeline" };
      writeFileSync(rows, `${JSON.stringify(step)}\n${JSON.stringify(pipeline)}\n`);
      expect(fieldfile("runs", rows).status).toBe(1);
      mkdirSync(join(dir, "field"));
      const first = fieldfile("runs", rows);
      expect(first.status, first.stderr).toBe(0);
      expect(first.stdout.split("\n").filter(Boolean)).toEqual([
        join("field", "runs", "2026-11-11-t562-tests1.json"),
        join("field", "runs", "2026-11-11-t562-lane.json"),
      ]);
      expect(JSON.parse(readFileSync(join(dir, "field/runs/2026-11-11-t562-tests1.json"), "utf8"))).toEqual({
        ...step,
        run: "2026-11-11-t562-tests1",
      });
      const again = { ...pipeline, run: "2026-11-11-t562-other" };
      writeFileSync(rows, `${JSON.stringify(again)}\n${JSON.stringify(step)}\n`);
      const clash = fieldfile("runs", rows);
      expect(clash.status).toBe(1);
      expect(clash.stderr).toContain("2026-11-11-t562-tests1.json exists");
      expect(existsSync(join(dir, "field/runs/2026-11-11-t562-other.json"))).toBe(false);
      expect(readdirSync(join(dir, "field/runs")).toSorted()).toEqual([
        "2026-11-11-t562-lane.json",
        "2026-11-11-t562-tests1.json",
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
