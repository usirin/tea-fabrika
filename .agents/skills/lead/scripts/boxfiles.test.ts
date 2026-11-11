// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "./agents.ts?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "./botpush.mjs?raw";
import "./box.sh?raw";
import "./clauderow.py?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "./drive.ts?raw";
import "./env.sh?raw";
import "./fieldrow.py?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "./gc.ts?raw";
import "./keepruns.sh?raw";
import "./leakgrep.sh?raw";
import "./mutbox-entry.sh?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "./mutbox.Dockerfile?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "./mutbox.ts?raw";
import "./redact.sh?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "./sizecap.ts?raw";
import "../../mutation/scripts/run.sh?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "../../mutation/scripts/sample.ts?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "../../mutation/scripts/scope.ts?raw";
import "../../plan/scripts/plancheck.sh?raw";
import "../../step-commit/scripts/exam.py?raw";
import "../../step-commit/scripts/stepcommit.sh?raw";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { codexHomeOf } from "@kampus/fabrika-old/agents/acp";
import fc from "fast-check";
import { afterAll, describe, expect, it } from "vitest";
import { boxLanes, fateFor, hasLanded, judgeBox, ownerName } from "./boxfiles.ts";
import { boxTree, boxView, IDLE, oldBoxTree } from "./lane.ts";

// Today's tooling. The rules are pure; one scenario runs the script on a folder of its own.
const options = { seed: 119120, numRuns: 300 };
const word = fc.stringMatching(/^[a-z][a-z0-9]{0,6}$/);
const branch = word.map((w) => `fabrikalfa/${w}`);

describe("box files, today's tooling", () => {
  // Edge 1. Plants: count a closed or open PR as landed; forget the -wip backup branch.
  it("calls a lane landed only on a merged PR of its branch, less -wip, with no open one", () => {
    fc.assert(
      fc.property(branch, fc.boolean(), fc.uniqueArray(branch), fc.uniqueArray(branch), (b, wip, merged, open) => {
        const m = new Set(merged);
        const o = new Set(open);
        const landed = hasLanded(wip ? `${b}-wip` : b, m, o);
        expect(landed).toBe(m.has(b) && !o.has(b) && !o.has(`${b}-wip`));
        expect(hasLanded(undefined, m, o)).toBe(false);
      }),
      options,
    );
  });

  // Edge 5. Plants: take the first name that matches; drop the separator check.
  it("gives a file to the longest name it starts with, then . or -, and to none without one", () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(word, { minLength: 1, maxLength: 6 }),
        word,
        fc.constantFrom(".", "-", "", "0"),
        (names, rest, sep) => {
          const file = `${names[0]}${sep}${rest}`;
          const owner = ownerName(file, names);
          const fits = names.filter((n) => file.startsWith(n) && [".", "-"].includes(file.charAt(n.length)));
          expect(owner).toBe(fits.length === 0 ? null : fits.reduce((a, b) => (b.length > a.length ? b : a)));
        },
      ),
      options,
    );
  });

  // vector: the two collisions the real boxes folder has (t5-tests1 beside t5-tests10, lane names).
  it("vector: never takes another box's or a lane's file", () => {
    expect(ownerName("t5-tests10.md", ["t5-tests1", "t5-tests10"])).toBe("t5-tests10");
    expect(ownerName("t5-tests10.md", ["t5-tests1"])).toBe(null);
    expect(ownerName("a-tests1-rows.jsonl", ["a-tests1", "a-tests1-rows"])).toBe("a-tests1-rows");
    expect(ownerName("a-tests1-rows.jsonl", ["a-tests1", "a-tests1"])).toBe("a-tests1");
    expect(ownerName("t5-tests1", ["t5-tests1"])).toBe(null);
  });

  // Edge 7 and the view. vector: each suffix drive, gc or the lead writes.
  it("vector: leaves git data and the sign worktree, removes a view, moves the rest", () => {
    expect(["-gitdata", "-sign", "-view", ".md", "-prompt.md", "-mutbox", ".rows.jsonl"].map(fateFor)).toEqual([
      "leave",
      "leave",
      "remove",
      "move",
      "move",
      "move",
      "move",
    ]);
  });

  // Edges 2, 3, 4. Plants: sweep when one of two lanes landed; sweep a box gc keeps; sweep a fresh file.
  it("sweeps only when every lane landed, the tree is gone or going, and nothing changed for 2 h", () => {
    fc.assert(
      fc.property(
        fc.array(fc.boolean(), { maxLength: 3 }),
        fc.boolean(),
        fc.boolean(),
        fc.nat(3 * IDLE),
        (landed, tree, gone, idle) => {
          const v = judgeBox({ landed, tree, gone, idle });
          const may = landed.length > 0 && landed.every(Boolean) && (!tree || gone) && idle >= IDLE;
          expect(v._tag === "sweep").toBe(may);
        },
      ),
      options,
    );
  });

  // Plants: give a judgment box to a lane with no state file; drop a step's box.
  it("knows each step's box and each judgment box of a known lane, and no other", () => {
    fc.assert(
      fc.property(fc.uniqueArray(word, { minLength: 1, maxLength: 4 }), fc.nat(9), word, (lanes, n, stranger) => {
        const states = lanes.map((lane) => ({ lane, steps: [{ box: `${lane}-tests${n}` }] }));
        const names = [...lanes.map((l) => `${l}-judge${n}.md`), `${stranger}x-judge${n}.md`];
        const got = boxLanes(states, names);

        for (const lane of lanes) {
          expect(got.get(`${lane}-tests${n}`)).toContain(lane);
          expect(got.get(`${lane}-judge${n}`)).toEqual([lane]);
        }

        expect(got.has(`${stranger}x-judge${n}`)).toBe(lanes.includes(`${stranger}x`));
      }),
      options,
    );
  });

  describe("scenario: one landed lane, one running, on a folder of its own", () => {
    const dir = mkdtempSync(join(tmpdir(), "boxfiles-"));
    afterAll(() => rmSync(dir, { recursive: true, force: true }));
    const boxes = join(dir, "boxes");
    const main = join(dir, "main");
    const home = join(dir, "home");
    const old = (Date.now() - 3 * IDLE) / 1000;
    const put = (path: string, text = "x", fresh = false) => {
      mkdirSync(join(path, ".."), { recursive: true });
      writeFileSync(path, text);
      utimesSync(path, fresh ? Date.now() / 1000 : old, fresh ? Date.now() / 1000 : old);
    };
    const folder = (path: string, fresh = false) => {
      put(join(path, "inside"), "x", fresh);
      utimesSync(path, fresh ? Date.now() / 1000 : old, fresh ? Date.now() / 1000 : old);
    };
    const lane = (name: string, branch: string, steps: string[]) =>
      put(
        join(boxes, "state", `${name}.json`),
        JSON.stringify({ lane: name, branch, steps: steps.map((box) => ({ box })) }),
      );

    // Lane `done` landed: tests1's tree is gone, build1's tree is still there (gc keeps it),
    // review1 wrote a file a minute ago. Lane `live` has an open PR.
    lane("done", "fabrikalfa/done", ["done-tests1", "done-build1", "done-review1"]);
    lane("live", "fabrikalfa/live", ["live-tests1"]);

    for (const f of [
      "done-tests1.md",
      "done-tests1-prompt.md",
      "done-tests1.jsonl",
      "done-judge2.md",
      "done-rows.jsonl",
      "done-PLAN.md",
      "done-build1.md",
      "live-tests1.md",
    ]) {
      put(join(boxes, f));
    }

    put(join(boxes, "done-review1.md"), "x", true);
    folder(join(boxes, "done-tests1-mutbox"));
    folder(join(boxes, "done-tests1-gitdata"));
    folder(join(boxes, "done-tests1-view"));
    folder(boxView(boxes, "done-tests1"));
    folder(boxTree(boxes, "done-build1"));
    put(join(boxes, "state", "done-tests1.rows.jsonl"));
    // A link in a box's files is moved as a link; its target stays.
    put(join(dir, "target"));
    symlinkSync(join(dir, "target"), join(boxes, "done-tests1.err"));
    // A report already archived under the same name: the new one gets -1.
    put(join(main, "runs", "boxes", "done", "done-tests1.md"), "older");
    // Codex homes: the box's, with sessions and a login link, and the main checkout's.
    const codex = codexHomeOf(boxTree(boxes, "done-tests1"), { HOME: home });
    folder(join(codex, "sessions"));
    symlinkSync(join(home, "login"), join(codex, "auth.json"));
    utimesSync(codex, old, old);
    folder(codexHomeOf(main, { HOME: home }));
    folder(codexHomeOf(oldBoxTree(boxes, "done-review1"), { HOME: home }));
    const run = (dry: boolean) =>
      spawnSync(
        process.execPath,
        [
          join(import.meta.dirname, "boxfiles.ts"),
          "--boxes",
          boxes,
          "--main",
          main,
          ...(dry ? ["--dry-run"] : []),
          ...["--merged", "fabrikalfa/done", "--merged", "fabrikalfa/live", "--open", "fabrikalfa/live"],
        ],
        { encoding: "utf8", env: { ...process.env, HOME: home } },
      );
    const listing = () =>
      [boxes, main, home]
        .flatMap((d) => readdirSync(d, { recursive: true, encoding: "utf8" }).map((p) => join(d, p)))
        .sort();

    // Edge 12. Plants: let the dry run move one file.
    it("scenario: a dry run changes nothing and says what it would sweep", () => {
      const before = listing();
      const ran = run(true);
      expect(ran.status, ran.stderr).toBe(0);
      expect(listing()).toEqual(before);
      expect(ran.stdout).toContain("would sweep done-tests1: would move 7");
      expect(ran.stdout).toContain("would sweep done-judge2: would move 1");
    });

    // Edges 3, 4, 6, 7, 8, 9, 11. Plants: remove the lane's rows; overwrite the archived report;
    // follow the link; remove main's Codex home; sweep a box whose tree is there or whose file is fresh.
    it("scenario: moves a landed lane's gone box's files, removes its view and Codex home, keeps the rest", () => {
      const ran = run(false);
      expect(ran.status, ran.stderr).toBe(0);
      const archive = join(main, "runs", "boxes", "done");

      for (const f of [
        "done-tests1.md-1",
        "done-tests1-prompt.md",
        "done-tests1.jsonl",
        "done-tests1-mutbox/inside",
        "done-tests1.err",
        "state/done-tests1.rows.jsonl",
        "done-tests1-codex-sessions/inside",
        "done-judge2.md",
      ]) {
        expect(existsSync(join(archive, f)), f).toBe(true);
      }

      expect(readdirSync(archive).includes("done-tests1.md")).toBe(true);

      for (const gone of [
        "done-tests1.md",
        "done-tests1-mutbox",
        "done-tests1-view",
        "done-tests1.err",
        "state/done-tests1.rows.jsonl",
      ]) {
        expect(existsSync(join(boxes, gone)), gone).toBe(false);
      }

      expect(existsSync(boxView(boxes, "done-tests1"))).toBe(false);
      expect(existsSync(codex)).toBe(false);
      expect(existsSync(join(dir, "target"))).toBe(true);

      for (const kept of [
        "done-tests1-gitdata/inside",
        "done-rows.jsonl",
        "done-PLAN.md",
        "done-build1.md",
        "done-review1.md",
        "live-tests1.md",
      ]) {
        expect(existsSync(join(boxes, kept)), kept).toBe(true);
      }

      expect(existsSync(codexHomeOf(main, { HOME: home }))).toBe(true);
      expect(existsSync(codexHomeOf(oldBoxTree(boxes, "done-review1"), { HOME: home }))).toBe(true);
      expect(ran.stdout).toContain("keep files of done-build1: its tree is still there");
      expect(ran.stdout).toMatch(/keep files of done-review1: a file changed \d+ min ago/);
    });
  });
});
