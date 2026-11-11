import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  TOP,
  ENV,
  sh,
  KEYS,
  stepKeys,
  GOOD_KEYS,
  repoCount,
  Repo,
  DONE,
  runs,
  name,
  stuck,
  ask,
  squashed,
  log,
  twoSteps,
} from "./commits-git.test-support.ts";

describe("done", () => {
  // scenario: two real signing commands and their printed notes must agree with git.
  it("scenario: a tests commit then a build commit off the list, each signed by its role with `sign`", () => {
    const r = new Repo();
    r.change("a.ts");
    const signed = r.signWith("tests");
    expect(signed.code).toBe(0);
    expect(signed.answers[0]).toMatchObject({ _tag: "attested", step: "tests", version: 1 });
    r.change("b.ts");
    expect(r.signWith("build").code).toBe(0);
    const out = r.check();
    expect(out.answers).toEqual([DONE]);
    expect(out.code).toBe(0);
    expect(out.err).toContain("ticket 229");
  });

  // scenario: real merge ancestry and its three-dot diff are the behavior.
  it("scenario: a lead commit that merges main in, then a build commit: main's exam change asks nothing", () => {
    const r = new Repo();
    r.change("a.ts");
    r.sign("tests");
    r.git("checkout", "-q", "main");
    r.write("boundary-rules.json", "[1]\n");
    const main = r.commit("main moves");
    r.git("checkout", "-q", "pr");
    r.git("merge", "-q", "--no-edit", "main");
    r.sign("lead");
    r.change("b.ts");
    r.sign("build");
    expect(r.check([], main).answers).toEqual([DONE]);
  });

  // scenario: three signing commands share a real notes ref and its version counter.
  it("scenario: tests v1, a build commit, then tests v2 after the mutation step, all in the chain", () => {
    const r = new Repo();
    r.change("a.test.ts");
    r.signWith("tests");
    r.change("b.ts");
    r.signWith("build");
    r.change("c.test.ts");
    const again = r.signWith("tests");
    expect(again.answers[0]).toMatchObject({ step: "tests", version: 2 });
    expect(r.check().answers).toEqual([ask("next/packages/x/src/a.test.ts", "next/packages/x/src/c.test.ts")]);
  });

  // scenario: a separate git commit and forged signed note must stay outside the branch.
  it("scenario: a note on a commit outside the pull request claims tests version 99 with a bad signature", () => {
    const r = new Repo();
    r.change("a.ts");
    r.sign("tests");
    r.change("b.ts");
    r.sign("build");
    const outside = r.git("commit-tree", "-p", r.base, "-m", "x", r.head("HEAD^{tree}")).trim();
    const forged = r.sign("tests", { sha: outside, version: 99 });
    r.setNote(outside, JSON.stringify({ ...forged, sig: forged.sig.replace("A", "B") }));
    expect(r.check().answers).toEqual([DONE]);
  });
});

describe("ask exam_read (p85)", () => {
  // scenario: two real signed commits distinguish step file changes from the PR diff.
  it("scenario: a tests commit adding a next/ test and changing boundary-rules.json, then a clean build", () => {
    const r = new Repo();
    r.write("next/packages/x/src/a.test.ts", "t\n");
    r.write("boundary-rules.json", "[2]\n");
    r.commit();
    r.sign("tests");
    r.change("a.ts");
    r.sign("build");
    const out = r.check();
    expect(out.answers).toEqual([ask("boundary-rules.json", "next/packages/x/src/a.test.ts")]);
    expect(out.code).toBe(0);
  });

  // Plant: omit annotation escaping. Generate the name before the workflow command.
  it("G22: workflow command in a filename reached printed output (P32 hole 2)", () => {
    fc.assert(
      fc.property(name, (prefix) => {
        const r = new Repo();
        const name = `${prefix}\n::add-mask::next/apps/fabrika/src/exam/commits.ts`;
        r.write(name, "x\n");
        r.commit();
        r.sign("tests");
        const summary = join(r.dir, ".summary");
        const out = r.run(["check", "--base", r.base, "--head", "HEAD"], {
          ...ENV,
          GITHUB_STEP_SUMMARY: summary,
        });
        expect(out.answers).toEqual([ask(name)]);
        const lines = out.out.split("\n");
        expect(lines.some((l) => l.startsWith("::add-mask::"))).toBe(false);
        expect(lines).toContain(
          `::warning title=commits::ask owner exam_read ${prefix}%0A::add-mask::next/apps/fabrika/src/exam/commits.ts`,
        );
        const written = readFileSync(summary, "utf8");
        expect(written).toContain(JSON.stringify(name));
        expect(written.split("\n").some((l) => l.startsWith("::"))).toBe(false);
        expect(out.err.split("\n").some((l) => l.startsWith("::"))).toBe(false);
      }),
      runs,
    );
  });
});

describe("the scope rule", () => {
  // Plant: judge every path. Generate the docs file name outside the exam.
  it("G15: done, not in scope: only docs/ and field/ changed, its commits unsigned", () => {
    fc.assert(
      fc.property(name, (name) => {
        const r = new Repo();
        r.write(`docs/${name}.md`, "d\n");
        r.commit();
        r.write("field/notes.jsonl", "{}\n");
        r.commit();
        const out = r.check();
        expect(out.answers).toEqual([DONE]);
        expect(out.code).toBe(0);
        expect(out.err).toContain("not in scope");
      }),
      runs,
    );
  });

  // scenario: a three-commit history must be judged in full once its last file enters scope.
  it("scenario: judged: the same plus one file under next/, every commit unsigned_commit", () => {
    const r = new Repo();
    r.write("docs/x.md", "d\n");
    const c1 = r.commit();
    r.write("field/notes.jsonl", "{}\n");
    const c2 = r.commit();
    const c3 = r.change("a.ts");
    expect(r.check().answers).toEqual([
      stuck("unsigned_commit", c1),
      stuck("unsigned_commit", c2),
      stuck("unsigned_commit", c3),
    ]);
  });

  // Plant: skip exam-only changes. Generated initial contents vary the real trees.
  it("G16: judged when only an exam path changed, read from the base's list", () => {
    fc.assert(
      fc.property(fc.string(), (initial) => {
        const r = new Repo(GOOD_KEYS, undefined, "sha1", initial);
        r.write("boundary-rules.json", "[5]\n");
        const c = r.commit();
        expect(r.check().answers).toEqual([stuck("unsigned_commit", c), ask("boundary-rules.json")]);
      }),
      runs,
    );
  });
});

describe("judged at the event's head (hole 3)", () => {
  // scenario: real revision selection must stop at the saved event commit.
  it("scenario: the branch gets one more unsigned commit after the event; the event's head is judged", () => {
    const r = new Repo();
    r.change("a.ts");
    r.sign("tests");
    r.change("b.ts");
    r.sign("build");
    const event = r.head();
    r.change("late.ts");
    expect(r.check([], r.base, event).answers).toEqual([DONE]);
  });

  // scenario: a bare remote, a later push and an independent CI clone exercise fetching.
  it("scenario: with --fetch, CI's own clone of main fetches the event's shas and notes, and nothing newer", () => {
    const origin = join(TOP, `origin${repoCount()}.git`);
    sh(TOP, "git", ["init", "-q", "--bare", "-b", "main", origin]);
    const r = new Repo();
    r.git("remote", "add", "origin", origin);
    r.git("push", "-q", "origin", "main");
    r.change("a.ts");
    r.signWith("tests");
    r.change("b.ts");
    r.signWith("build");
    const pushed = r.run(["push"]);
    expect(pushed.code).toBe(0);
    expect(r.git("ls-remote", "origin")).toContain("refs/notes/fabrika");
    const event = r.head();
    r.change("late.ts");
    r.git("push", "-q", "origin", "pr");
    const ci = join(TOP, `ci${repoCount()}`);
    sh(TOP, "git", ["clone", "-q", "--branch", "main", origin, ci]);
    const args = ["check", "--fetch", "--pr", "7", "--base", r.base, "--head", event, "--main", r.base];
    const out = r.run(args, ENV, ci);
    expect(out.answers).toEqual([DONE]);
    expect(out.err).toContain("2 commits");
    const bad = r.run(["check", "--fetch", "--pr", "7", "--base", r.base, "--head", "pr"], ENV, ci);
    expect(bad.code).toBe(2);
    expect(bad.answers).toEqual([]);
    const noMain = r.run(args.slice(0, -2), ENV, ci);
    expect(noMain.code).toBe(2);
    expect(noMain.err).toContain("--main");
  });
});

describe("sign", () => {
  // Plant: skip sign verification. Generated initial contents vary the real trees.
  it("G17: refuses a key that does not verify as its step, and adds no note", () => {
    fc.assert(
      fc.property(fc.string(), (initial) => {
        const r = new Repo(GOOD_KEYS, undefined, "sha1", initial);
        r.change("a.ts");
        const out = r.run(["sign", "--step", "tests", "--ticket", "229", "--key", join(KEYS, "build")]);
        expect(out.code).toBe(2);
        expect(r.git("notes", "--ref=fabrika", "list")).toBe("");
      }),
      runs,
    );
  });

  // scenario: two real signing commands and persisted notes establish per-ticket versions.
  it("scenario: counts its versions per step and ticket, and the printed link is what the note holds", () => {
    const r = new Repo();
    r.change("a.ts");
    r.signWith("tests", "300");
    r.change("b.ts");
    const first = r.signWith("tests", "229");
    expect(first.answers[0]).toMatchObject({ version: 1, ticket: "229", commit: r.head() });
    const note = JSON.parse(r.git("notes", "--ref=fabrika", "show", "HEAD"));
    const { commit: _, ...printed } = first.answers[0]!;
    expect(note).toEqual(printed);
    expect(note.key).toMatch(/^SHA256:/);
  });
});

/** A squash on main of the branch, and its links logged in field/runs.jsonl in a later commit. */
describe("chain after the merge (p86 and p89)", () => {
  // d4: in a real repo, whichever logged link carries cause (with or without parent), or lacks
  // parent or traceId, chain stops on that row's line and answers nothing. The same log without
  // the change answers done. One repo for this property, and few runs, since each spawns git and
  // node; commits.test.ts's decoder laws cover the input space at 100 runs. Plants: drop
  // onExcessProperty; make parent or traceId optional; read cause as the old name for parent.
  it("d4: any logged link with cause, or without parent or traceId, stops the chain on its line", () => {
    const r = new Repo();
    const { squash, rows } = squashed(r, twoSteps(r));
    log(r, rows);
    expect(r.run(["chain", "--squash", squash])).toMatchObject({ code: 0, answers: [DONE] });
    // A cause of null or a string is what an old link held, so it comes up often.
    const cause = fc.oneof(fc.constant(null), fc.string(), fc.jsonValue());
    const change = fc.oneof(
      cause.map((cause) => ({ _tag: "cause" as const, cause, keepParent: true })),
      cause.map((cause) => ({ _tag: "cause" as const, cause, keepParent: false })),
      fc.constantFrom({ _tag: "drop" as const, field: "parent" }, { _tag: "drop" as const, field: "traceId" }),
    );
    fc.assert(
      fc.property(fc.nat(rows.length - 1), change, (at, how) => {
        const bad = structuredClone(rows);
        const link: Record<string, unknown> = bad[at]!.attested[0]!;

        if (how._tag === "cause") {
          if (!how.keepParent) {
            delete link.parent;
          }

          link.cause = how.cause;
        } else {
          delete link[how.field];
        }

        log(r, bad);
        const out = r.run(["chain", "--squash", squash]);
        expect(out.code).toBe(2);
        expect(out.answers).toEqual([]);
        expect(out.err).toContain(`field/runs.jsonl line ${at + 1}: a link that does not read`);
      }),
      { seed: 119120, endOnFailure: true, numRuns: 8 },
    );
  });

  // scenario: signed commits, squash and later log commits require a fixed real git history.
  it("scenario: done: a squash whose links run from its base's tree to its tree, one through a lead merge", () => {
    const r = new Repo();
    const c1 = r.change("a.ts");
    const n1 = r.sign("tests");
    r.git("checkout", "-q", "main");
    r.write("docs/other.md", "o\n");
    r.commit("main moves");
    r.git("checkout", "-q", "pr");
    r.git("merge", "-q", "--no-edit", "main");
    const c2 = r.head();
    const n2 = r.sign("lead");
    const c3 = r.change("b.ts");
    const n3 = r.sign("build");
    const { squash, rows } = squashed(r, [
      { note: n1, commit: c1 },
      { note: n2, commit: c2 },
      { note: n3, commit: c3 },
    ]);
    log(r, rows);
    const out = r.run(["chain", "--squash", squash]);
    expect(out.answers).toEqual([DONE]);
    expect(out.code).toBe(0);
  });

  // scenario: signed commits, squash and later log commits require a fixed real git history.
  it("scenario: broken_chain: field/ links with a gap between two links", () => {
    const r = new Repo();
    const steps = twoSteps(r);
    const { squash, rows } = squashed(r, steps);
    log(r, [rows[1]!]);
    expect(r.run(["chain", "--squash", squash]).answers).toEqual([stuck("broken_chain", squash)]);
  });

  // scenario: signed commits, squash and later log commits require a fixed real git history.
  it("scenario: broken_chain: a link whose sig was made over another to", () => {
    const r = new Repo();
    const steps = twoSteps(r);
    const { squash, rows } = squashed(r, steps);
    const other = r.sign("build", { sha: steps[0]!.commit });
    const bad = rows[1]!.attested[0]!;
    rows[1]!.attested[0] = { ...bad, sig: other.sig };
    log(r, rows);
    expect(r.run(["chain", "--squash", squash]).answers).toEqual([stuck("broken_chain", squash)]);
  });

  // scenario: signed commits, squash and later log commits require a fixed real git history.
  // 0098 changed it: this was broken_chain, and a pull request that landed behind main is done.
  it("scenario: done: the last link's to is the head's tree, and the squash took a main that moved", () => {
    const r = new Repo();
    const { squash, rows } = squashed(r, twoSteps(r), true);
    log(r, rows);
    expect(r.run(["chain", "--squash", squash])).toMatchObject({ code: 0, answers: [DONE] });
  });

  // scenario: a real squash behind main, logged without its last link, has a real gap at its end.
  it("scenario: broken_chain: landed behind main, and the build's link is left out of the log", () => {
    const r = new Repo();
    const { squash, rows } = squashed(r, twoSteps(r), true);
    log(r, [rows[0]!]);
    expect(r.run(["chain", "--squash", squash]).answers).toEqual([stuck("broken_chain", squash)]);
  });

  // scenario: a real squash behind main that holds more than the head brought: no link names its change.
  it("scenario: broken_chain: landed behind main, and the squash holds a file the head never had", () => {
    const r = new Repo();
    const { rows } = squashed(r, twoSteps(r), true);
    r.write("next/packages/x/src/extra.ts", "extra\n");
    r.git("add", "-A");
    r.git("commit", "-q", "--amend", "-m", "squash");
    const squash = r.head();
    const moved = rows.map((row) => ({
      ...row,
      attested: row.attested.map((l) => ({ ...l, squash })),
    }));
    log(r, moved);
    expect(r.run(["chain", "--squash", squash]).answers).toEqual([stuck("broken_chain", squash)]);
  });

  // scenario: a real lead merge of main, then main moves again before the squash: the pinned base
  // (the first link's) still merges cleanly onto the newer main.
  it("scenario: done: a head that took a lead merge of main, landed behind a main that moved again", () => {
    const r = new Repo();
    const c1 = r.change("a.ts");
    const n1 = r.sign("tests");
    r.git("checkout", "-q", "main");
    r.write("docs/first.md", "1\n");
    r.commit("main moves");
    r.git("checkout", "-q", "pr");
    r.git("merge", "-q", "--no-edit", "main");
    const c2 = r.head();
    const n2 = r.sign("lead");
    const c3 = r.change("b.ts");
    const n3 = r.sign("build");
    const { squash, rows } = squashed(
      r,
      [
        { note: n1, commit: c1 },
        { note: n2, commit: c2 },
        { note: n3, commit: c3 },
      ],
      true,
    );
    log(r, rows);
    expect(r.run(["chain", "--squash", squash])).toMatchObject({ code: 0, answers: [DONE] });
  });

  // scenario: a row's commit is unsigned, so a real forged commit whose parent is a newer main must
  // not pick the merge base. Plant: drop `--merge-base`, and the squash that reverts main's fix passes.
  it("scenario: broken_chain: landed behind main, a forged row commit on main's fix hides its revert", () => {
    const r = new Repo();
    r.git("checkout", "-q", "main");
    r.write("f.txt", "vuln\n");
    const left = r.commit("main at A");
    r.git("checkout", "-q", "pr");
    r.git("reset", "-q", "--hard", left);
    const steps = twoSteps(r);
    const tree = r.head("HEAD^{tree}");
    r.git("checkout", "-q", "main");
    r.write("f.txt", "fixed\n");
    const fix = r.commit("main fixes f");
    r.write("docs/other.md", "o\n");
    r.commit("main moves");
    r.git("merge", "--squash", "-q", "pr");
    r.write("f.txt", "vuln\n");
    const squash = r.commit("squash that reverts the fix");
    const forged = r.git("commit-tree", tree, "-p", fix, "-m", "forged").trim();
    const rows = steps.map(({ note, commit }, i) => ({
      date: "2026-11-11",
      run: `r${i}`,
      attested: [
        {
          ...note,
          by: "agent:planted",
          arrivedAt: "2026-11-11T10:00:00-08:00",
          parent: null,
          traceId: `trace-step-${i}`,
          commit: i === steps.length - 1 ? forged : commit,
          pr: "usirin/tea-fabrika#1",
          base: left,
          squash,
          keys: r.base,
        },
      ],
    }));
    log(r, rows);
    expect(r.run(["chain", "--squash", squash]).answers).toEqual([stuck("broken_chain", squash)]);
  });

  // scenario: signed commits, squash and later log commits require a fixed real git history.
  it("scenario: broken_chain: a link signed by a key that allowed_signers did not hold at the row's keys commit", () => {
    const r = new Repo();
    const c1 = r.change("a.ts");
    const n1 = r.sign("tests");
    const c2 = r.change("b.ts");
    const n2 = r.sign("stranger");
    r.git("checkout", "-q", "-b", "rotate", r.base);
    r.write("allowed_signers", stepKeys("stranger"));
    const rotated = r.commit("rotate");
    r.git("checkout", "-q", "pr");
    const { squash, rows } = squashed(r, [
      { note: n1, commit: c1 },
      { note: n2, commit: c2 },
    ]);
    log(r, rows);
    expect(r.run(["chain", "--squash", squash]).answers).toEqual([stuck("broken_chain", squash)]);
    // A keys commit on a side branch, never on main: it holds the key, and still counts for nothing.
    rows[1]!.attested[0] = { ...rows[1]!.attested[0]!, keys: rotated };
    log(r, rows);
    expect(r.run(["chain", "--squash", squash]).answers).toEqual([stuck("broken_chain", squash)]);
  });

  // scenario: signed commits, squash and later log commits require a fixed real git history.
  it("scenario: done: a key main added before the squash counts, at a keys commit on main", () => {
    const r = new Repo();
    r.git("checkout", "-q", "main");
    r.write("allowed_signers", stepKeys("stranger"));
    const rotated = r.commit("rotate");
    r.git("checkout", "-q", "pr");
    r.git("merge", "-q", "--no-ff", "--no-edit", "main");
    const c1 = r.head();
    const n1 = r.sign("lead");
    const c2 = r.change("b.ts");
    const n2 = r.sign("stranger");
    const { squash, rows } = squashed(r, [
      { note: n1, commit: c1 },
      { note: n2, commit: c2 },
    ]);
    rows[1]!.attested[0] = { ...rows[1]!.attested[0]!, keys: rotated };
    log(r, rows);
    expect(r.run(["chain", "--squash", squash]).answers).toEqual([DONE]);
  });

  // scenario: signed commits, squash and later log commits require a fixed real git history.
  it("scenario: broken_chain: a log pull request that adds its own keys commit and points its rows at it", () => {
    const r = new Repo();
    const c1 = r.change("a.ts");
    const n1 = r.sign("tests");
    const c2 = r.change("b.ts");
    const n2 = r.sign("stranger");
    const { squash, rows } = squashed(r, [
      { note: n1, commit: c1 },
      { note: n2, commit: c2 },
    ]);
    const main = r.head();
    r.git("checkout", "-q", "-b", "log", main);
    r.write("allowed_signers", stepKeys("stranger"));
    const forged = r.commit("my own keys");
    rows[1]!.attested[0] = { ...rows[1]!.attested[0]!, keys: forged };
    log(r, rows);
    const out = r.run(["chain", "--base", main, "--head", "HEAD"]);
    expect(out.answers).toEqual([stuck("broken_chain", squash)]);
    expect(out.code).toBe(1);
  });

  // scenario: signed commits, squash and later log commits require a fixed real git history.
  it("scenario: broken_chain: a log pull request naming a squash that is not on main", () => {
    const r = new Repo();
    const steps = twoSteps(r);
    r.git("checkout", "-q", "-b", "elsewhere", r.base);
    r.git("merge", "--squash", "-q", "pr");
    const fake = r.commit("a squash off main");
    const { rows } = squashed(r, steps);
    const main = r.head();
    r.git("checkout", "-q", "-b", "log", main);
    const moved = rows.map((row) => ({
      ...row,
      attested: row.attested.map((l) => ({ ...l, squash: fake })),
    }));
    log(r, moved);
    expect(r.run(["chain", "--base", main, "--head", "HEAD"]).answers).toEqual([stuck("broken_chain", fake)]);
  });

  // scenario: signed commits, squash and later log commits require a fixed real git history.
  it("scenario: broken_chain: a link whose base has the base's tree but is not on main", () => {
    const r = new Repo();
    const steps = twoSteps(r);
    const { squash, rows } = squashed(r, steps);
    const twin = r.git("commit-tree", "-p", r.base, "-m", "twin", r.head(`${r.base}^{tree}`)).trim();
    const moved = rows.map((row) => ({
      ...row,
      attested: row.attested.map((l) => ({ ...l, base: twin })),
    }));
    log(r, moved);
    expect(r.run(["chain", "--squash", squash]).answers).toEqual([stuck("broken_chain", squash)]);
  });

  // scenario: signed commits, squash and later log commits require a fixed real git history.
  it("scenario: broken_chain: a log row whose attested key is written with an escape is read all the same", () => {
    const r = new Repo();
    const steps = twoSteps(r);
    const { squash, rows } = squashed(r, steps);
    const main = r.head();
    const line = JSON.stringify(rows[1]!).replaceAll('"attested"', '"\\u0061ttested"');
    r.write("field/runs.jsonl", `${line}\n`);
    r.commit("log");
    const out = r.run(["chain", "--base", main, "--head", "HEAD"]);
    expect(out.answers).toEqual([stuck("broken_chain", squash)]);
    expect(out.code).toBe(1);
  });

  // scenario: signed commits, squash and later log commits require a fixed real git history.
  it("scenario: stale_link: field/ rows hold a tests link for the ticket newer than any the squash's chain uses", () => {
    const r = new Repo();
    const steps = twoSteps(r);
    r.git("checkout", "-q", "-b", "redo", r.base);
    const c = r.change("z.ts");
    const newer = r.sign("tests", { version: 2 });
    r.git("checkout", "-q", "pr");
    const { squash, rows } = squashed(r, steps);
    const extra = {
      ...rows[0]!,
      attested: [{ ...rows[0]!.attested[0]!, ...newer, commit: c, squash: c }],
    };
    log(r, [...rows, extra]);
    expect(r.run(["chain", "--squash", squash]).answers).toEqual([stuck("stale_link", squash, { step: "tests" })]);
  });

  // scenario: signed commits, squash and later log commits require a fixed real git history.
  it("scenario: blocks a log pull request for the squashes its new rows name, and passes a good one", () => {
    const r = new Repo();
    const steps = twoSteps(r);
    const { squash, rows } = squashed(r, steps);
    const before = r.head();
    log(r, [rows[1]!]);
    const bad = r.run(["chain", "--base", before, "--head", "HEAD"]);
    expect(bad.answers).toEqual([stuck("broken_chain", squash)]);
    expect(bad.code).toBe(1);
    log(r, rows);
    const good = r.run(["chain", "--base", before, "--head", "HEAD"]);
    expect(good.answers).toEqual([DONE]);
    expect(good.code).toBe(0);
  });
});
