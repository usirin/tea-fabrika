import "./leakgrep.sh?raw";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import fc from "fast-check";
import { describe, expect, it } from "vitest";

// Ticket 548, today's tooling (owner, 2026-11-10, decision 0048): the leak check reads each commit
// a push sends on its own. `leakgrep.sh --commits <rev>...` reads every commit `git rev-list
// <rev>...` names: a commit as its diff from its parent, a first commit as all it holds, a merge
// as the lines that are new against every parent. Every history here is one git itself wrote.
const script = process.env.TEST_LEAKGREP ?? join(import.meta.dirname, "leakgrep.sh");
const options = { seed: 548, numRuns: 8 };

// A made-up private word, and one made-up line of each kind the check knows.
const word = "private_zzqxjv";

const leaks = [word, "/" + "home/someone/work", String.fromCodePoint(0x2014), `npm_${"a".repeat(36)}`];

// What the bot's push asks for: every commit of the source that no ref of origin holds.
const pushed = ["HEAD", "--not", "--remotes=origin"];

type Read = {
  readonly status: number | null;
  /** How many commits the check says it read, when it found nothing. */
  readonly commits: number | null;
  /** The hits of each commit, by the commit id the check printed. */
  readonly hits: Readonly<Record<string, number>>;
  readonly total: number;
  readonly respaced: number;
};

const lab = <A>(
  body: (lab: {
    git: (...args: string[]) => string;
    /** Write these files, stage everything and commit. Returns the id the check prints. */
    commit: (files: Readonly<Record<string, ReadonlyArray<string> | Buffer | null>>) => string;
    /** Mark HEAD as held by origin. */
    push: (branch?: string) => void;
    read: (...revs: string[]) => Read;
  }) => A,
): A => {
  const dir = mkdtempSync(join(tmpdir(), "lg-commits-"));

  try {
    const repo = join(dir, "repo");
    const words = join(dir, "words");
    mkdirSync(repo);
    writeFileSync(words, `${word}\n`);
    const run = (allowed: ReadonlyArray<number>, ...args: string[]) => {
      const ran = spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.invalid", ...args], {
        cwd: repo,
        encoding: "utf8",
      });
      expect(allowed, ran.stderr).toContain(ran.status);
      return ran.stdout.trim();
    };
    const git = (...args: string[]) => run([0], ...args);
    git("init", "-q", "-b", "work");

    return body({
      git,
      commit: (files) => {
        for (const [name, lines] of Object.entries(files)) {
          if (lines === null) {
            rmSync(join(repo, name));
          } else {
            writeFileSync(join(repo, name), Buffer.isBuffer(lines) ? lines : lines.map((line) => `${line}\n`).join(""));
          }
        }

        git("add", "-A");
        git("commit", "-q", "--allow-empty", "-m", "a commit");
        return git("rev-parse", "HEAD").slice(0, 12);
      },
      push: (branch = "main") => {
        git("update-ref", `refs/remotes/origin/${branch}`, "HEAD");
      },
      // It never prints the text it matched.
      read: (...revs) => {
        const ran = spawnSync("sh", [script, "--commits", ...revs], {
          cwd: repo,
          encoding: "utf8",
          env: { ...process.env, FABRIKA_LEAK_WORDS: words, TYPESAFE_API_KEY: undefined },
        });
        const hits: Record<string, number> = {};

        for (const line of ran.stderr.split("\n")) {
          const hit = /^leakgrep: leak \w+ at added line \d+ of commit ([0-9a-f]{12})$/.exec(line);

          if (hit?.[1] !== undefined) {
            hits[hit[1]] = (hits[hit[1]] ?? 0) + 1;
          }
        }

        const total = Object.values(hits).reduce((sum, n) => sum + n, 0);
        const clean = /^leakgrep: (\d+) commits read, added text clean$/.exec(ran.stdout.trim());
        const old = /^leakgrep: (\d+) flagged lines only respace/m.exec(ran.stderr);

        if (ran.status === 0 || ran.status === 1) {
          expect(ran.status, ran.stderr).toBe(total === 0 ? 0 : 1);
          expect(clean === null, ran.stdout).toBe(total !== 0);
        }

        for (const leak of leaks) {
          expect(ran.stdout + ran.stderr).not.toContain(leak);
        }

        return {
          status: ran.status,
          commits: clean === null ? null : Number(clean[1]),
          hits,
          total,
          respaced: old === null ? 0 : Number(old[1]),
        };
      },
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

// One commit of a history: the lines it adds at the end of the file, each clean or flagged, and
// how many of the file's oldest lines it removes.
const step = fc.record({
  adds: fc.array(fc.option(fc.constantFrom(...leaks), { nil: null }), { maxLength: 3 }),
  drops: fc.nat({ max: 3 }),
});

describe("T548 the leak check reads each pushed commit on its own, today's tooling", () => {
  // Plants: read only the last commit; read the range as one net diff; skip a commit whose lines a
  // later commit removes.
  it("gives each commit the hits of the lines that commit adds, whatever later commits do", () => {
    fc.assert(
      fc.property(fc.array(step, { minLength: 1, maxLength: 6 }), (steps) =>
        lab(({ commit, push, read }) => {
          commit({ "a.md": ["base"] });
          push();
          let lines: string[] = ["base"];
          const expected: Record<string, number> = {};

          for (const [n, { adds, drops }] of steps.entries()) {
            // Every added line is new text: no other line of the history holds its first word.
            const added = adds.map((leak, m) => `line${n}x${m} ${leak ?? "plain"}`);
            lines = [...lines.slice(drops), ...added];
            const id = commit({ "a.md": lines });
            const flagged = adds.filter((leak) => leak !== null).length;

            if (flagged > 0) {
              expected[id] = flagged;
            }
          }

          const got = read(...pushed);
          expect(got.hits).toEqual(expected);

          if (got.total === 0) {
            expect(got.commits).toBe(steps.length);
          }
        }),
      ),
      {
        ...options,
        examples: [
          // pinned: the decision's own case, a line one commit adds and the next removes.
          [
            [
              { adds: [word], drops: 0 },
              { adds: [], drops: 2 },
            ],
          ],
          // pinned: a commit that only removes adds nothing.
          [[{ adds: [], drops: 1 }]],
        ],
      },
    );
  });

  // Plant: clear a flagged line when any commit of the range removes its text.
  it("reads a line as old text only when the same commit removes it with other spacing (0047)", () => {
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom(...leaks), { minLength: 1, maxLength: 4 }),
        fc.constantFrom("\t", "  ", " \t "),
        (held, gap) =>
          lab(({ commit, push, read }) => {
            const old = held.map((leak, n) => `old${n} ${leak} end`);
            commit({ "a.md": old });
            push();
            // One commit respaces every line main already holds: old text, no hit.
            const respaced = old.map((line) => gap + line.replaceAll(" ", gap));
            commit({ "a.md": respaced });
            expect(read(...pushed)).toMatchObject({ total: 0, commits: 1, respaced: held.length });
            // One commit removes the lines and the next adds them back with other spacing: the
            // second commit removes nothing, so its lines are new text.
            commit({ "a.md": ["kept"] });
            const back = commit({ "a.md": ["kept", ...old.map((line) => ` ${line}`)] });
            expect(read(...pushed).hits).toEqual({ [back]: held.length });
          }),
      ),
      options,
    );
  });

  it("scenario: a merge is read as the lines that are new against every parent", () => {
    lab(({ git, commit, push, read }) => {
      commit({ "a.md": ["base"], "b.md": ["base"] });
      push();
      git("checkout", "-q", "-b", "upstream");
      // Main moved on while the branch was open, and holds a flagged line of its own.
      commit({ "b.md": ["base", `main says ${word}`] });
      push();
      git("checkout", "-q", "work");
      commit({ "a.md": ["base", "branch says plain"] });
      git("merge", "-q", "--no-edit", "origin/main");
      // The merge brings main's line to the branch. Main already holds it: not this push's text.
      expect(read(...pushed)).toMatchObject({ total: 0, commits: 2 });
    });
  });

  it("scenario: a merge's own line, one neither parent holds, is a hit of the merge", () => {
    lab(({ git, commit, push, read }) => {
      commit({ "a.md": ["base"] });
      push();
      git("checkout", "-q", "-b", "upstream");
      commit({ "a.md": [`main says ${word}`] });
      push();
      git("checkout", "-q", "work");
      commit({ "a.md": ["branch says plain"] });
      // Both sides changed the one line, so git stops and a person writes the merged file.
      git("-c", "core.hooksPath=/dev/null", "merge", "-q", "--no-commit", "-X", "ours", "origin/main");
      const taken = commit({ "a.md": [`main says ${word}`, "branch says plain"] });
      // Main's line was taken as it is, and the branch's line is the branch's own: nothing new.
      expect(git("rev-list", "--parents", "-n1", "HEAD").split(" ")).toHaveLength(3);
      expect(read(...pushed)).toMatchObject({ total: 0, commits: 2 });
      git("reset", "-q", "--hard", "HEAD^");
      git("-c", "core.hooksPath=/dev/null", "merge", "-q", "--no-commit", "-X", "ours", "origin/main");
      const merge = commit({ "a.md": [`the merge says ${leaks[1]}`, "branch says plain"] });
      expect(merge).not.toBe(taken);
      expect(read(...pushed).hits).toEqual({ [merge]: 1 });
      // 0047: a merge clears nothing. Main's line with other spacing is the merge's own new text.
      git("reset", "-q", "--hard", "HEAD^");
      git("-c", "core.hooksPath=/dev/null", "merge", "-q", "--no-commit", "-X", "ours", "origin/main");
      const respaced = commit({ "a.md": [`main  says ${word}`, "branch says plain"] });
      expect(read(...pushed).hits).toEqual({ [respaced]: 1 });
    });
  });

  it("scenario: a commit origin already holds is not read, on main or on the branch", () => {
    lab(({ commit, push, read }) => {
      commit({ "a.md": [`main says ${word}`] });
      push();
      commit({ "a.md": [`main says ${word}`, `pushed before ${leaks[2]}`] });
      push("fabrikalfa/lane");
      commit({ "a.md": [`main says ${word}`, `pushed before ${leaks[2]}`, "plain"] });
      expect(read(...pushed)).toMatchObject({ total: 0, commits: 1 });
    });
  });

  it("vector: an empty range reads no commit and passes", () => {
    lab(({ commit, push, read }) => {
      commit({ "a.md": [word] });
      push();
      expect(read(...pushed)).toMatchObject({ status: 0, total: 0, commits: 0 });
    });
  });

  it("scenario: a new branch with no upstream is read from its first commit, as all it holds", () => {
    lab(({ commit, read }) => {
      // No ref of origin exists at all, so the first commit has no parent to be read against.
      const first = commit({ "a.md": ["plain", `first says ${word}`] });
      const second = commit({ "a.md": ["plain"], "b.md": [leaks[3] ?? ""] });
      expect(read(...pushed).hits).toEqual({ [first]: 1, [second]: 1 });
    });
  });

  it("scenario: a renamed file adds only the lines the commit wrote", () => {
    lab(({ git, commit, push, read }) => {
      const held = ["one", "two", `three ${word}`, "four", "five", "six"];
      commit({ "a.md": held });
      push();
      git("mv", "a.md", "b.md");
      commit({});
      expect(read(...pushed)).toMatchObject({ total: 0, commits: 1 });
      git("mv", "b.md", "c.md");
      const edited = commit({ "c.md": [...held, `seven ${leaks[1]}`] });
      expect(read(...pushed).hits).toEqual({ [edited]: 1 });
    });
  });

  it("scenario: a commit with a binary file is read without a refusal, with its text files", () => {
    lab(({ commit, push, read }) => {
      commit({ "a.md": ["base"] });
      push();
      const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff, 0xfe, 0x00, 0x0a, 0x00]);
      commit({ "image.png": bytes });
      expect(read(...pushed)).toMatchObject({ status: 0, total: 0, commits: 1 });
      const mixed = commit({ "image.png": Buffer.concat([bytes, bytes]), "a.md": ["base", word] });
      expect(read(...pushed).hits).toEqual({ [mixed]: 1 });
    });
  });

  it("pinned: a push of 50 commits is read commit by commit, one hit for each", () => {
    lab(({ commit, push, read }) => {
      commit({ "a.md": ["base"] });
      push();
      const expected: Record<string, number> = {};

      // Each commit replaces the last commit's flagged line with one of its own.
      for (let n = 0; n < 50; n += 1) {
        expected[commit({ "a.md": ["base", `line${n} ${leaks[n % leaks.length]}`] })] = 1;
      }

      expect(read(...pushed).hits).toEqual(expected);
    });
  });

  it("vector: a range git cannot read, or no range at all, refuses with exit 2", () => {
    lab(({ commit, read }) => {
      commit({ "a.md": ["plain"] });
      expect(read("no-such-ref")).toMatchObject({ status: 2, total: 0, commits: null });
      expect(read()).toMatchObject({ status: 2, total: 0, commits: null });
    });
  });
});
