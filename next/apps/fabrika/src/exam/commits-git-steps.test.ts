import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  EXAM_LIST,
  TOP,
  ENV,
  sh,
  KEYS,
  pub,
  fingerprint,
  keyLine,
  GOOD_KEYS,
  personLine,
  PERSON_KEYS,
  repoCount,
  Repo,
  DONE,
  runs,
  name,
  stuck,
  ask,
  verifyCommit,
  personLink,
  squashed,
  log,
  twoSteps,
} from "./commits-git.test-support.ts";

describe("stale_link (p89)", () => {
  // scenario: branch switching and real sign commands share the notes version history.
  it("scenario: tests signs version 1, redoes it as version 2 on another commit; the branch uses version 1", () => {
    const r = new Repo();
    const t1 = r.change("a.test.ts");
    r.signWith("tests");
    r.git("checkout", "-q", "-b", "redo", r.base);
    r.change("a2.test.ts");
    expect(r.signWith("tests").answers[0]).toMatchObject({ version: 2 });
    r.git("checkout", "-q", "pr");
    r.change("b.ts");
    r.sign("build");
    expect(r.check().answers).toEqual([
      stuck("stale_link", t1, { step: "tests" }),
      ask("next/packages/x/src/a.test.ts"),
    ]);
  });

  // scenario: two branches hold independent signatures at the same version.
  it("scenario: two verified tests links for the ticket, both version 2", () => {
    const r = new Repo();
    const t = r.change("a.ts");
    r.sign("tests", { version: 2 });
    r.git("checkout", "-q", "-b", "other", r.base);
    r.change("z.ts");
    r.sign("tests", { version: 2 });
    r.git("checkout", "-q", "pr");
    expect(r.check().answers).toEqual([stuck("stale_link", t, { step: "tests" })]);
  });
});

describe("build_touched_exam (p84)", () => {
  // Plant: omit build exam refusal. Generated initial contents vary the real trees.
  it("G13: a build commit changing next/apps/fabrika/src/exam/commits.ts", () => {
    fc.assert(
      fc.property(fc.string(), (initial) => {
        const r = new Repo(GOOD_KEYS, undefined, "sha1", initial);
        const path = "next/apps/fabrika/src/exam/commits.ts";
        r.write(path, "weaker\n");
        const c = r.commit();
        r.sign("build");
        expect(r.check().answers).toEqual([stuck("build_touched_exam", c, { paths: [path] }), ask(path)]);
      }),
      runs,
    );
  });

  // scenario: git rename detection must return both sides of the move.
  it("scenario: a build commit moving a file out of fixtures/next/: the rename's old path", () => {
    const r = new Repo();
    mkdirSync(join(r.dir, "next/packages/x"), { recursive: true });
    r.git("mv", "fixtures/next/v.txt", "next/packages/x/v.txt");
    const c = r.commit();
    r.sign("build");
    expect(r.check().answers).toEqual([
      stuck("build_touched_exam", c, { paths: ["fixtures/next/v.txt"] }),
      ask("fixtures/next/v.txt"),
    ]);
  });

  // scenario: real tree reads must use the ancestor list despite the changed list on head.
  it("scenario: a build commit dropping a row from exam-paths.json and touching that path: the base's list counts", () => {
    const r = new Repo();
    const rows = JSON.parse(EXAM_LIST) as Array<{ glob: string }>;
    r.write("exam-paths.json", JSON.stringify(rows.filter((row) => row.glob !== "boundary-rules.json")));
    r.write("boundary-rules.json", "[3]\n");
    const c = r.commit();
    r.sign("build");
    const both = ["boundary-rules.json", "exam-paths.json"];
    expect(r.check().answers).toEqual([stuck("build_touched_exam", c, { paths: both }), ask(...both)]);
  });

  // scenario: git first-parent merge changes differ from the PR three-dot diff.
  it("scenario: a build commit that merges main in, bringing main's exam change", () => {
    const r = new Repo();
    r.change("a.ts");
    r.sign("tests");
    r.git("checkout", "-q", "main");
    r.write("boundary-rules.json", "[4]\n");
    const main = r.commit("main moves");
    r.git("checkout", "-q", "pr");
    r.git("merge", "-q", "--no-edit", "main");
    const merge = r.head();
    r.sign("build");
    expect(r.check([], main).answers).toEqual([stuck("build_touched_exam", merge, { paths: ["boundary-rules.json"] })]);
  });

  // Plant: ignore control characters in exam paths. Generate the file name around the CR.
  it("G14: a build commit adding a file whose name holds a carriage return", () => {
    fc.assert(
      fc.property(name, (name) => {
        const r = new Repo();
        const path = `next/packages/x/${name}\rb.ts`;
        r.write(path, "x\n");
        const c = r.commit();
        r.sign("build");
        expect(r.check().answers).toEqual([stuck("build_touched_exam", c, { paths: [path] }), ask(path)]);
      }),
      runs,
    );
  });
});

/** Moves main ahead of the branch by `n` commits, each touching `path`, and checks the branch out again. */
const moveMain = (r: Repo, n: number, path = "docs/other.md") => {
  r.git("checkout", "-q", "main");
  let main = r.base;

  for (let i = 0; i < n; i += 1) {
    r.write(path, `[${i}]\n`);
    main = r.commit(`main moves ${i}`);
  }

  r.git("checkout", "-q", "pr");
  return main;
};

describe("a branch behind main at pull request time (0098)", () => {
  // scenario: two diverged branches distinguish a three-dot diff from a two-dot diff.
  it("scenario: the branch is behind main, whose own exam change asks nothing (a three-dot diff)", () => {
    const r = new Repo();
    r.change("a.ts");
    r.sign("tests");
    r.change("b.ts");
    r.sign("build");
    const head = r.head();
    const main = moveMain(r, 1, "boundary-rules.json");
    expect(r.check([], main, head).answers).toEqual([DONE]);
  });

  // scenario: event base, event head and newer main need separate real histories.
  it("scenario: the branch contains the event's base but not the newer main CI checked out", () => {
    const r = new Repo();
    r.change("a.ts");
    r.sign("tests");
    const head = r.head();
    const main = moveMain(r, 1);
    expect(r.check([], r.base, head).answers).toEqual([DONE]);
    expect(r.check(["--main", main], r.base, head).answers).toEqual([DONE]);
  });

  // Plant: answer broken_chain when main is not an ancestor of the head. Generated: how far behind.
  it("G24: a branch behind main by any number of commits, each validly linked, is done", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 4 }), (n) => {
        const r = new Repo();
        twoSteps(r);
        const head = r.head();
        const main = moveMain(r, n);
        expect(r.check(["--main", main], r.base, head)).toMatchObject({ code: 0, answers: [DONE] });
      }),
      runs,
    );
  });

  // scenario: being behind must hide nothing; one real unsigned commit among signed ones.
  it("scenario: behind main with one unsigned commit: unsigned_commit, and nothing else", () => {
    const r = new Repo();
    r.change("a.ts");
    r.sign("tests");
    const bare = r.change("b.ts");
    const head = r.head();
    const main = moveMain(r, 2);
    expect(r.check(["--main", main], r.base, head)).toMatchObject({
      code: 1,
      answers: [stuck("unsigned_commit", bare)],
    });
  });

  // scenario: main's newer exam changes are main's, never the branch's, in a real diverged history.
  it("scenario: behind main whose newer commits touch exam paths: no ask and no build_touched_exam", () => {
    const r = new Repo();
    twoSteps(r);
    const head = r.head();
    moveMain(r, 1, "boundary-rules.json");
    const main = moveMain(r, 1, "next/apps/fabrika/src/exam/commits.ts");
    expect(r.check(["--main", main], main, head).answers).toEqual([DONE]);
  });

  // scenario: a real build commit on a diverged branch still meets the exam list.
  it("scenario: behind main, a build commit touching an exam path is still build_touched_exam", () => {
    const r = new Repo();
    r.change("a.ts");
    r.sign("tests");
    r.write("boundary-rules.json", "[9]\n");
    const c = r.commit();
    r.sign("build");
    const main = moveMain(r, 2);
    expect(r.check(["--main", main], main, c).answers).toEqual([
      stuck("build_touched_exam", c, { paths: ["boundary-rules.json"] }),
      ask("boundary-rules.json"),
    ]);
  });

  // scenario: real sign commands on two branches, then main moves past the one under test.
  it("scenario: behind main, a tests link newer than the one the branch uses is still stale_link", () => {
    const r = new Repo();
    const t1 = r.change("a.ts");
    r.signWith("tests");
    r.git("checkout", "-q", "-b", "redo", r.base);
    r.change("a2.ts");
    r.signWith("tests");
    r.git("checkout", "-q", "pr");
    r.change("b.ts");
    r.sign("build");
    const head = r.head();
    const main = moveMain(r, 1);
    expect(r.check(["--main", main], main, head).answers).toEqual([stuck("stale_link", t1, { step: "tests" })]);
  });

  // scenario: a note planted over another commit's trees is a gap; at pull request time it does not fit.
  it("scenario: behind main, a link that does not start where the last ended is unsigned_commit, never done", () => {
    const r = new Repo();
    const c1 = r.change("a.ts");
    r.sign("tests");
    const c2 = r.change("b.ts");
    const n2 = r.sign("build");
    r.setNote(c2, JSON.stringify({ ...n2, from: r.head(`${c1}^1^{tree}`) }));
    const main = moveMain(r, 1);
    expect(r.check(["--main", main], main, c2).answers).toEqual([stuck("unsigned_commit", c2)]);
  });
});

describe("the run fails (p87), judging no commit", () => {
  // Plant: silently pass an invalid or absent trusted keys file.
  it.each([
    [
      "an ECDSA key",
      `${[keyLine("tests", "tests"), keyLine("build", "build"), keyLine("lead", "ecdsa")].join("\n")}\n`,
    ],
    ["a key under tests and build", `${GOOD_KEYS}${keyLine("build", "tests")}\n`],
    ["an unknown principal", `${GOOD_KEYS}${keyLine("owner", "stranger")}\n`],
    ["a missing namespace", `${GOOD_KEYS}build ${pub("stranger")}\n`],
    ["no allowed_signers on the base", null],
  ])("G20: %s", (_, keys) => {
    fc.assert(
      fc.property(fc.string(), (initial) => {
        const r = new Repo(keys, undefined, "sha1", initial);
        r.change("a.ts");
        const out = r.check();
        expect(out.code).toBe(2);
        expect(out.answers).toEqual([]);
        expect(out.err).toContain("allowed_signers");
      }),
      runs,
    );
  });
});

describe("person commits between step links (p86b)", () => {
  // scenario: alternate real signed commits isolate each mismatched part of one logged proof.
  it.each([
    "the wrong key",
    "another signature",
    "another to tree",
    "another from tree",
    "an unsigned commit",
    "a step key",
  ] as const)("scenario: refuses a person link with %s", (plant) => {
    const r = new Repo(PERSON_KEYS);
    r.write("next/packages/x/src/a.ts", "a\n");
    const person = r.gitSigned();
    expect(verifyCommit(r, person)).toBe(0);
    const middle = personLink(r, person);
    expect(middle.from).not.toBe(middle.to);
    const signedCommit = (parent: string, tree: string, who: "person" | "tests" = "person") =>
      r
        .git(
          "-c",
          "gpg.format=ssh",
          "-c",
          `user.signingkey=${join(KEYS, who)}`,
          "commit-tree",
          "-S",
          "-p",
          parent,
          "-m",
          "planted signed commit",
          tree,
        )
        .trim();
    const { squash, rows } = squashed(r, [{ note: middle, commit: person }]);
    const row = rows[0]!.attested[0]!;

    switch (plant) {
      case "the wrong key":
        row.key = fingerprint("tests");
        break;
      case "another signature":
        row.sig = personLink(r, signedCommit(r.base, middle.from)).sig;
        break;
      case "another to tree":
      case "another from tree": {
        const other = plant === "another to tree" ? signedCommit(r.base, middle.from) : signedCommit(person, middle.to);
        expect(verifyCommit(r, other)).toBe(0);
        row.commit = other;
        row.sig = personLink(r, other).sig;
        break;
      }
      case "an unsigned commit":
        row.commit = r.git("commit-tree", "-p", r.base, "-m", "unsigned", middle.to).trim();
        break;
      case "a step key": {
        const other = signedCommit(r.base, middle.to, "tests");
        expect(verifyCommit(r, other, `fixture namespaces="git" ${pub("tests")}\n`)).toBe(0);
        row.commit = other;
        row.key = fingerprint("tests");
        row.sig = personLink(r, other, "tests").sig;
        break;
      }
    }

    log(r, rows);
    const out = r.run(["chain", "--squash", squash]);
    expect(out.answers).toEqual([stuck("broken_chain", squash)]);
    expect(out.code).toBe(1);
  });

  // Plant: ignore the logged signature mismatch. Generated contents vary the signed trees.
  it("G23: xgpgsig was read as gpgsig (95c3610a)", () => {
    fc.assert(
      fc.property(fc.string(), (initial) => {
        const r = new Repo(PERSON_KEYS, undefined, "sha1", initial);
        r.write("next/packages/x/src/a.ts", "a\n");
        const person = r.gitSigned();
        const payload = r
          .git("cat-file", "commit", person)
          .replace(/^gpgsig .*(?:\n .*)*\n/m, "")
          .replace("\n\n", "\nxgpgsig forged\n\n");
        const sig = sh(r.dir, "ssh-keygen", ["-Y", "sign", "-n", "git", "-f", join(KEYS, "person")], payload);
        const raw = payload.replace("\n\n", `\ngpgsig ${sig.trimEnd().replaceAll("\n", "\n ")}\n\n`);
        const c = sh(r.dir, "git", ["hash-object", "-t", "commit", "-w", "--stdin"], raw).trim();
        expect(verifyCommit(r, c)).toBe(0);
        const { squash, rows } = squashed(r, [{ note: { ...personLink(r, c), sig: "forged\n" }, commit: c }]);
        log(r, rows);
        const out = r.run(["chain", "--squash", squash]);
        expect(out.answers).toEqual([stuck("broken_chain", squash)]);
        expect(out.code).toBe(1);
      }),
      runs,
    );
  });

  // scenario: a native signed commit passes git but its logged chain reads an incomplete ancestor file.
  it("scenario: refuses a person link whose keys file is incomplete", () => {
    const keys = `${keyLine("tests", "tests")}\n${personLine("github:42")}\n`;
    const r = new Repo(keys);
    r.write("next/packages/x/src/a.ts", "a\n");
    const person = r.gitSigned();
    expect(verifyCommit(r, person, keys)).toBe(0);
    const { squash, rows } = squashed(r, [{ note: personLink(r, person), commit: person }]);
    log(r, rows);
    const out = r.run(["chain", "--squash", squash]);
    expect(out.answers).toEqual([stuck("broken_chain", squash)]);
    expect(out.code).toBe(1);
  });

  // scenario: an independent single-branch clone must fetch a missing signed object.
  it("scenario: fetches a missing signed person commit before checking its logged link", () => {
    const r = new Repo(PERSON_KEYS);
    r.write("next/packages/x/src/a.ts", "a\n");
    const person = r.gitSigned();
    const { squash, rows } = squashed(r, [{ note: personLink(r, person), commit: person }]);
    log(r, rows);
    const ci = join(TOP, `person-ci${repoCount()}`);
    sh(TOP, "git", ["clone", "-q", "--no-local", "--single-branch", "--branch", "main", r.dir, ci]);
    const missing = spawnSync("git", ["cat-file", "-e", `${person}^{commit}`], { cwd: ci, env: ENV });
    expect(missing.error).toBeUndefined();
    expect(missing.status).not.toBe(0);
    const out = r.run(["chain", "--squash", squash], ENV, ci);
    expect(out.answers, out.err).toEqual([DONE]);
    expect(out.code).toBe(0);
    expect(sh(ci, "git", ["cat-file", "-e", `${person}^{commit}`])).toBe("");
  });

  // scenario: three signed commits must connect through both squash and the later log.
  it.each(["file change", "empty commit"] as const)(
    "scenario: connects tests, a person's %s, then build, before and after squash",
    (change) => {
      const r = new Repo(PERSON_KEYS);
      const tests = r.change("a.ts");
      const first = r.sign("tests");

      if (change === "file change") {
        r.write("next/packages/x/src/person.ts", "person\n");
      }

      const person = r.gitSigned();
      expect(verifyCommit(r, person)).toBe(0);
      const middle = personLink(r, person);
      const build = r.change("b.ts");
      const last = r.sign("build");
      expect(first.to).toBe(middle.from);
      expect(middle.to).toBe(last.from);
      expect(middle.from === middle.to).toBe(change === "empty commit");
      const before = r.check();
      const { squash, rows } = squashed(r, [
        { note: first, commit: tests },
        { note: middle, commit: person },
        { note: last, commit: build },
      ]);
      log(r, rows);
      const after = r.run(["chain", "--squash", squash]);
      expect(before.answers).toEqual([DONE]);
      expect(before.code).toBe(0);
      expect(after.answers, after.err).toEqual([DONE]);
      expect(after.code).toBe(0);
    },
  );

  // scenario: a real unsigned middle commit leaves a tree gap after squash.
  it("scenario: refuses an unsigned commit between step links, before and after squash", () => {
    const r = new Repo(PERSON_KEYS);
    const tests = r.change("a.ts");
    const first = r.sign("tests");
    const gap = r.change("unsigned.ts");
    const build = r.change("b.ts");
    const last = r.sign("build");
    expect(first.to).not.toBe(last.from);
    const before = r.check();
    expect(before.answers).toEqual([stuck("unsigned_commit", gap)]);
    expect(before.code).toBe(1);
    const { squash, rows } = squashed(r, [
      { note: first, commit: tests },
      { note: last, commit: build },
    ]);
    log(r, rows);
    const out = r.run(["chain", "--squash", squash]);
    expect(out.answers).toEqual([stuck("broken_chain", squash)]);
    expect(out.code).toBe(1);
  });

  // scenario: native signed merge ancestry is checked before and after catching up.
  // 0098 changed it: the head behind main was broken_chain, and is now judged as it stands, done.
  it("scenario: counts a person's signed merge of main, and the head before it is done too", () => {
    const r = new Repo(PERSON_KEYS);
    r.change("a.ts");
    r.sign("tests");
    const behind = r.head();
    r.git("checkout", "-q", "main");
    r.write("docs/other.md", "main moved\n");
    const main = r.commit("main moves");
    r.git("checkout", "-q", "pr");
    r.git(
      "-c",
      "gpg.format=ssh",
      "-c",
      `user.signingkey=${join(KEYS, "person")}`,
      "merge",
      "-q",
      "--gpg-sign",
      "--no-edit",
      "main",
    );
    expect(verifyCommit(r, r.head())).toBe(0);
    const stale = r.check([], main, behind);
    r.change("b.ts");
    r.sign("build");
    const merged = r.check([], main);
    expect(merged.answers).toEqual([DONE]);
    expect(merged.code).toBe(0);
    expect(stale.answers).toEqual([DONE]);
    expect(stale.code).toBe(0);
  });
});

describe("0053 historical exam lists", () => {
  // Plant: read --main or head for the old build. Pinned: P14 a7ff4ee8 before PR 687.
  it("g1: old tsconfig build passes after main adds its row", () => {
    fc.assert(
      fc.property(name, (folder) => {
        const r = new Repo(GOOD_KEYS, undefined, "sha1", "x", '[{"glob":"exam-paths.json","why":"policy"}]');
        const path = `next/${folder}/tsconfig.json`;
        r.write(path, "{}");
        r.commit();
        r.sign("build");
        r.git("checkout", "-q", "main");
        r.write("exam-paths.json", EXAM_LIST);
        const main = r.commit();
        r.git("checkout", "-q", "pr");
        r.git("merge", "-q", "--no-edit", "main");
        r.sign("lead");
        expect(r.check([], main).answers).toEqual([ask(path)]);
      }),
      runs,
    );
  });
  // Plant: use the lane's initial list for every build.
  it("g2: later tsconfig build uses the restored parent row", () => {
    fc.assert(
      fc.property(name, (folder) => {
        const r = new Repo(GOOD_KEYS, undefined, "sha1", "x", '[{"glob":"exam-paths.json","why":"policy"}]');
        const path = `next/${folder}/tsconfig.json`;
        r.write(path, "{}");
        r.commit();
        r.sign("build");
        r.git("checkout", "-q", "main");
        r.write("exam-paths.json", EXAM_LIST);
        const main = r.commit();
        r.git("checkout", "-q", "pr");
        r.git("merge", "-q", "--no-edit", "main");
        r.sign("lead");
        r.write(path, "{ }");
        const later = r.commit();
        r.sign("build", { version: 2 });
        expect(r.check([], main).answers).toEqual([stuck("build_touched_exam", later, { paths: [path] }), ask(path)]);
      }),
      runs,
    );
  });
  // Plant: missing is empty, fallback to main, or exit 2 without answers.
  it("g3: unreadable parent list refuses build and asks owner", () => {
    fc.assert(
      fc.property(fc.string(), (text) => {
        for (const mode of ["delete", "folder", "text"]) {
          const r = new Repo();
          r.git("rm", "exam-paths.json");

          if (mode === "folder") {
            r.write("exam-paths.json/child", text);
          }

          if (mode === "text") {
            r.write("exam-paths.json", `invalid:${text}`);
          }

          r.commit();
          r.sign("tests");
          const c = r.change("a.ts");
          r.sign("build");
          const out = r.check();
          expect(out.answers).toEqual([stuck("no_exam_list", c), ask("exam-paths.json")]);
          expect(out.code).toBe(1);
        }
      }),
      runs,
    );
  });
  // Plant: ask from head or parent rather than main.
  it("g4: dropped boundary row still requires owner read", () => {
    fc.assert(
      fc.property(fc.string(), (text) => {
        const r = new Repo();
        r.write("exam-paths.json", '[{"glob":"exam-paths.json","why":"policy"}]');
        r.commit();
        r.sign("tests");
        r.write("boundary-rules.json", `changed:${text}`);
        r.commit();
        r.sign("build");
        expect(r.check().answers).toEqual([ask("boundary-rules.json", "exam-paths.json")]);
      }),
      runs,
    );
  });
});
