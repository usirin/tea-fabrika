// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "./mutbox.ts?raw";
import "./mutbox-entry.sh?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "./mutbox.Dockerfile?raw";
import "../../mutation/scripts/run.sh?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "../../mutation/scripts/limit.ts?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "../../mutation/scripts/sample.ts?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "../../mutation/scripts/scope.ts?raw";
import "./catchup.sh?raw";
import "./leakgrep.sh?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "./botpush.mjs?raw";
import "./env.sh?raw";
import "./box.sh?raw";
import "./keepruns.sh?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "./drive.ts?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "./agents.ts?raw";
import "./fieldrow.py?raw";
import "./runplan.sh?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "./gc.ts?raw";
import "./redact.sh?raw";
import "./clauderow.py?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "./lane.ts?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "./freshmain.ts?raw";
import "../../plan/scripts/plancheck.sh?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "./sizecap.ts?raw";
import "../../step-commit/scripts/exam.py?raw";
import "../../step-commit/scripts/stepcommit.sh?raw";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  assertHead,
  type Check,
  green,
  link,
  matrixChecks,
  merged,
  merges,
  nextNames,
  options,
  type Post,
  reads,
  run,
  type Setup,
  success,
  tip,
  type View,
} from "./catchup.test-support.ts";

describe("catchup, today's tooling", () => {
  // T376: generated check-run data comes from GitHub, without a domain Schema.
  // Plants: require bare next, match a name prefix, or accept five green machines.
  it("T376 accepts a complete green matrix or a lone completed skipped next job in any order", () => {
    fc.assert(
      fc.property(
        fc.shuffledSubarray(matrixChecks, {
          minLength: matrixChecks.length,
          maxLength: matrixChecks.length,
        }),
        (checks) => {
          for (const list of [
            checks,
            [
              ...checks.filter((check) => !nextNames.includes(check.name)),
              { name: "next", status: "completed", conclusion: "skipped" },
            ],
          ]) {
            const got = run({ ...green, checks: list, clock: [0, 1, 3601] });
            expect(got.code, got.text).toBe(0);
            expect(merges(got.calls)).toHaveLength(1);
            assertHead(got.calls);
          }
        },
      ),
      { seed: 119120, numRuns: 12 },
    );
  });
  it.each(
    nextNames.flatMap((name) =>
      (["missing", "in_progress", "failure", "cancelled", "prefix"] as const).map((fault) => ({
        name,
        fault,
      })),
    ),
  )(
    "T376 every missing, pending, failed or canceled shard blocks even beside a bare next: $name $fault",
    ({ name, fault }) => {
      fc.assert(
        fc.property(
          fc.record({
            order: fc.shuffledSubarray(matrixChecks, {
              minLength: matrixChecks.length,
              maxLength: matrixChecks.length,
            }),
            bare: fc.constantFrom("success", "skipped"),
          }),
          ({ order, bare }) => {
            const checks = order.flatMap((check): Check[] =>
              check.name !== name
                ? [check]
                : fault === "missing"
                  ? []
                  : [
                      {
                        ...check,
                        name: fault === "prefix" ? `${name} extra` : name,
                        status: fault === "in_progress" ? "in_progress" : "completed",
                        conclusion: fault === "failure" || fault === "cancelled" ? fault : "success",
                      },
                    ],
            );
            checks.push({ name: "next", status: "completed", conclusion: bare });
            const got = run({ ...green, checks, clock: [0, 1, 3601] });
            expect(got.code, `${name}: ${fault}\n${got.text}`).toBe(1);
            expect(merges(got.calls)).toHaveLength(0);
            assertHead(got.calls);
          },
        ),
        { seed: 119120, numRuns: 2 },
      );
    },
  );
  it("T376 bare success and unfinished bare skips cannot stand in for the matrix", () => {
    fc.assert(
      fc.property(
        fc.shuffledSubarray(matrixChecks, {
          minLength: matrixChecks.length,
          maxLength: matrixChecks.length,
        }),
        (order) => {
          for (const check of [success("next"), { name: "next", status: "in_progress", conclusion: "skipped" }]) {
            const got = run({
              ...green,
              checks: [...order.filter((row) => !nextNames.includes(row.name)), check],
              clock: [0, 1, 3601],
            });
            expect(got.code, got.text).toBe(1);
            expect(merges(got.calls)).toHaveLength(0);
            assertHead(got.calls);
          }
        },
      ),
      { seed: 119120, numRuns: 2 },
    );
  });
  // Plants: merge without --squash; omit the head pin; do work after extra options; skip the head
  // read before a stack merge; stack-merge a PR whose head moved.
  it("T300 squash only, pinned to the checked head, and a stack lands by gh stack merge", () => {
    fc.assert(
      fc.property(
        fc.record({
          merge: fc.boolean(),
          answer: fc.constantFrom<Setup["answer"]>("green", "red", "ticket"),
          pending: fc.integer({ min: 0, max: 1 }),
          stack: fc.constantFrom<NonNullable<Setup["stack"]>>("none", "same", "moved"),
        }),
        ({ merge, answer: outcome, pending, stack }) => {
          for (const answer of new Set<Setup["answer"]>(["green", outcome])) {
            const got = run({ ...green, merge, answer, pending, stack });
            const reached = answer === "green";
            const lands = reached && stack !== "moved";
            expect(got.code, got.text).toBe(lands ? 0 : 1);
            const tried = merges(got.calls);
            expect(tried).toHaveLength(reached ? 1 : 0);

            for (const call of tried) {
              expect(call.args.filter((a) => a.startsWith("--") && a !== "--match-head-commit")).toEqual(["--squash"]);
            }

            const stacked = got.calls.filter((c) => c.key === "stack");
            expect(stacked.map((c) => c.args)).toEqual(
              reached && stack === "same" ? [["stack", "merge", "900", "--squash", "--yes"]] : [],
            );
            expect(got.calls.filter((c) => c.key === "oid")).toHaveLength(reached && stack !== "none" ? 1 : 0);
            assertHead(got.calls);
          }

          for (const args of [["--merge-method", "squash"], ["--merge-method", "merge"], ["--unknown"]]) {
            const got = run(green, args);
            expect(got.code, got.text).toBe(1);
            expect(got.calls).toEqual([]);
          }
        },
      ),
      { seed: 300, numRuns: 5 },
    );
  });

  // Plants: remove union; retain one side; deduplicate IDs. Plain conflicts must still abort.
  it("T300 real git preserves both field logs and aborts other conflicts without a push", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            id: fc.integer({ min: 0, max: 2 }),
            text: fc.stringMatching(/^[a-z]{1,8}$/),
          }),
          { minLength: 1, maxLength: 3 },
        ),
        (rows) => {
          for (const conflict of [false, true]) {
            const dir = mkdtempSync(join(tmpdir(), "cu-log-"));
            const git = (...args: string[]) => {
              const ran = spawnSync("/usr/bin/git", ["-C", dir, ...args], {
                encoding: "utf8",
                timeout: 5_000,
                env: {
                  ...process.env,
                  GIT_CONFIG_NOSYSTEM: "1",
                  GIT_CONFIG_GLOBAL: "/dev/null",
                  GIT_ATTR_NOSYSTEM: "1",
                  GIT_TERMINAL_PROMPT: "0",
                },
              });
              expect(ran.error).toBeUndefined();
              expect(ran.status, ran.stderr).toBe(0);
              return ran.stdout.trim();
            };

            try {
              git("init", "-q", "--initial-branch=main");
              git("config", "user.name", "Fixture");
              git("config", "user.email", "fixture@example.test");
              git("config", "core.attributesFile", "/dev/null");
              expect(git("remote")).toBe("");
              mkdirSync(join(dir, "field"));
              writeFileSync(
                join(dir, ".gitattributes"),
                readFileSync(join(import.meta.dirname, "../../../../.gitattributes")),
              );
              const prefix = rows.map((r) => JSON.stringify({ ...r, side: "base" }));
              const tails = ["ours", "theirs"].map((side) => rows.map((r) => JSON.stringify({ ...r, side })));
              const logs = ["runs", "notes"].map((name) => join(dir, `field/${name}.jsonl`));

              for (const log of logs) {
                writeFileSync(log, `${prefix.join("\n")}\n`);
              }

              writeFileSync(join(dir, "ordinary.txt"), "base\n");
              git("add", ".");
              git("commit", "-qm", "base");
              git("branch", "peer");

              for (const [i, branch] of ["main", "peer"].entries()) {
                git("checkout", "-q", branch);

                for (const log of logs) {
                  writeFileSync(log, `${[...prefix, ...tails[i]!].join("\n")}\n`);
                }

                if (conflict) {
                  writeFileSync(join(dir, "ordinary.txt"), `${branch}\n`);
                }

                git("add", ".");
                git("commit", "-qm", branch);
              }

              git("update-ref", "refs/remotes/origin/main", "peer");
              git("checkout", "-q", "main");
              const before = git("rev-parse", "HEAD");
              const got = run({ ...green, merge: true, repo: dir });
              expect(got.code, got.text).toBe(conflict ? 1 : 0);

              if (conflict) {
                expect(git("rev-parse", "HEAD")).toBe(before);
                expect(git("status", "--porcelain")).toBe("");
                expect(
                  got.calls.some(
                    (c) => c.cmd === "node" || c.cmd === "pnpm" || c.args[0] === "push" || c.key === "merge",
                  ),
                ).toBe(false);
              } else {
                for (const log of logs) {
                  const actual = readFileSync(log, "utf8").trimEnd().split("\n");
                  expect(actual.sort()).toEqual([...prefix, ...tails.flat()].sort());

                  for (const line of actual) {
                    expect(() => JSON.parse(line)).not.toThrow();
                  }
                }
              }
            } finally {
              rmSync(dir, { recursive: true, force: true });
            }
          }
        },
      ),
      { seed: 300, numRuns: 5 },
    );
  });
  // Plant: exit on the first read failure, or allow a fourth attempt.
  it("brief read failures recover within the three-attempt budget", () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 0, max: 4 }), { minLength: 5, maxLength: 5 }), (failures) => {
        const got = run({ ...green, failures });
        const stopped = failures.findIndex((n) => n >= 3);
        expect(got.code, got.text).toBe(stopped < 0 ? 0 : 1);

        for (const [i, key] of reads.entries()) {
          const expected = stopped >= 0 && i > stopped ? 0 : Math.min(failures[i]! + 1, 3);
          expect(got.calls.filter((c) => c.key === key).length, key).toBe(expected);
        }

        const waits = failures
          .slice(0, stopped < 0 ? 5 : stopped + 1)
          .flatMap((n) => (n === 0 ? [] : n === 1 ? ["1"] : ["1", "2"]));
        expect(got.calls.filter((c) => c.cmd === "sleep").map((c) => c.args[0])).toEqual(waits);
        expect(merges(got.calls)).toHaveLength(stopped < 0 ? 1 : 0);

        if (stopped > 0) {
          expect(got.text).toContain(tip);
        }

        if (stopped >= 0) {
          expect(got.text).toContain("gh");
        }

        assertHead(got.calls);
      }),
      options,
    );
  });

  // Plant: retry a successful red answer, mask failed logs, or use a different merge head.
  // A run that never started (startup_failure) neither blocks nor counts as a second run.
  it("red and untrusted answers never merge or get retried as transport failures", () => {
    fc.assert(
      fc.property(
        fc.record({
          answer: fc.constantFrom<Setup["answer"]>(
            "green",
            "red",
            "event",
            "duplicate",
            "startup",
            "app",
            "ticket",
            "trust-red",
          ),
          pending: fc.integer({ min: 0, max: 2 }),
          logFailures: fc.integer({ min: 3, max: 4 }),
          failures: fc.array(fc.integer({ min: 0, max: 2 }), { minLength: 5, maxLength: 5 }),
        }),
        ({ answer, pending, failures, logFailures }) => {
          const failedLogs = run({ ...green, failures: [0, 0, 0, 0, logFailures] });
          expect(failedLogs.code, failedLogs.text).toBe(1);
          expect(merges(failedLogs.calls)).toHaveLength(0);
          expect(failedLogs.calls.filter((c) => c.key === "logs")).toHaveLength(3);
          const got = run({ ...green, answer, pending, failures });
          const stop = {
            green: 5,
            red: 1,
            event: 2,
            duplicate: 2,
            startup: 5,
            app: 3,
            ticket: 4,
            "trust-red": 2,
          }[answer];
          const merged = answer === "green" || answer === "startup";
          expect(got.code, got.text).toBe(merged ? 0 : 1);
          expect(merges(got.calls)).toHaveLength(merged ? 1 : 0);

          for (const [i, key] of reads.entries()) {
            const count = i > stop ? 0 : failures[i]! + 1 + (key === "checks" ? pending : 0);
            expect(got.calls.filter((c) => c.key === key).length, key).toBe(count);
          }

          assertHead(got.calls);
        },
      ),
      options,
    );
  });

  // Plants: drop the freshmain call; call it after the merge; ignore its exit status.
  it("T552 scenario: the last look at main runs once on the checked head, after the checks and before the merge, and its refusal stops the merge (a merge must never outrun it)", () => {
    for (const [stale, stack] of [
      [false, "none"],
      [true, "none"],
      [false, "same"],
      [true, "same"],
    ] as const) {
      const got = run({ ...green, stale, stack });
      expect(got.code, got.text).toBe(stale ? 1 : 0);
      const looks = got.calls.filter((c) => c.cmd === "node" && c.args[0]!.endsWith("/freshmain.ts"));
      expect(looks.map((c) => c.args.slice(1))).toEqual([["900", tip]]);
      const order = got.calls.map((c) => (c.cmd === "node" && c.args[0]!.endsWith("/freshmain.ts") ? "look" : c.key));
      const landing = order.filter((key) => key === "merge" || key === "stack");
      expect(landing).toEqual(stale ? [] : stack === "same" ? ["merge", "stack"] : ["merge"]);
      expect(order.lastIndexOf("logs")).toBeLessThan(order.indexOf("look"));

      if (!stale) {
        expect(order.indexOf("look")).toBeLessThan(order.indexOf("merge"));
      } else {
        expect(got.text).toContain("pr 900: not merged");
      }
    }

    // A check that never came back green never reaches the look.
    const red = run({ ...green, answer: "red" });
    expect(red.calls.some((c) => c.cmd === "node" && c.args[0]!.endsWith("/freshmain.ts"))).toBe(false);
  });

  // Plants: drop the size line; let a failed size count stop the merge; count against another head.
  it("T686 scenario: the size line prints once, for the checked head against main, and a size count that fails stops nothing (0087 advises)", () => {
    for (const fails of [false, true]) {
      // The stub's sizecap fails whenever `stale` is set; the look then refuses the merge on its own.
      const got = run({ ...green, stale: fails });
      const sized = got.calls.filter((c) => c.cmd === "node" && c.args[0]!.endsWith("/sizecap.ts"));
      expect(sized.map((c) => c.args.slice(1))).toEqual([["diff", "origin/main", tip]]);
      expect(got.text).toContain(fails ? "pr 900: size not counted" : "pr 900: size: 7 product lines");
      expect(got.text).not.toContain("unhandled node command");
    }
  });

  // Plants: drop the BEHIND branch; merge behind without the sha pin or with another one; add
  // --admin, --auto or bypass_rules; retry the write; reach it on red checks or a red lint; treat a
  // 409 or a 405 as landed.
  it("T552 property: a green, linted pull request that gh refuses as BEHIND lands by one pinned REST squash; red checks, a red lint, a moved head or GitHub's own refusal stop it (0049)", () => {
    fc.assert(
      fc.property(
        fc.record({
          answer: fc.constantFrom<Setup["answer"]>("green", "red"),
          stale: fc.boolean(),
          behind: fc.boolean(),
          rest: fc.constantFrom<NonNullable<Setup["rest"]>>("merged", "moved", "refused"),
        }),
        ({ answer, stale, behind, rest }) => {
          const got = run({ ...green, answer, stale, behind, rest });
          const reached = answer === "green" && !stale;
          const behindTried = reached && behind;
          const lands = reached && (!behind || rest === "merged");
          expect(got.code, got.text).toBe(lands ? 0 : 1);
          expect(merges(got.calls)).toHaveLength(reached ? 1 : 0);

          const writes = got.calls.filter((c) => c.key === "rest");
          expect(writes.map((c) => c.args)).toEqual(
            behindTried
              ? [
                  [
                    "api",
                    "-X",
                    "PUT",
                    "repos/fixture/repo/pulls/900/merge",
                    "-f",
                    "merge_method=squash",
                    "-f",
                    `sha=${tip}`,
                  ],
                ]
              : [],
          );
          expect(got.calls.flatMap((c) => c.args).filter((a) => /--admin|--auto|bypass/.test(a))).toEqual([]);
          expect(got.calls.some((c) => c.key === "landed")).toBe(lands);

          if (behindTried && rest !== "merged") {
            expect(got.text).toContain("pr 900: merge behind main refused at");
            expect(got.text).toContain(rest === "moved" ? "HTTP 409" : "HTTP 405");
          }

          if (behindTried && rest === "merged") {
            expect(got.text).toContain("pr 900: landed behind main on purpose (0049)");
          }

          assertHead(got.calls);
        },
      ),
      { seed: 552, numRuns: 12 },
    );
  });

  // Plant: test the deadline only after the green-and-complete break, as review round 4 found.
  // The clock moves with each check read, so the law holds wherever the script reads `date`.
  it("no merge once the clock is past the hour, and a green answer in time still merges", () => {
    fc.assert(
      fc.property(
        fc.record({
          pending: fc.integer({ min: 0, max: 3 }),
          // One step per check read. 3,600 itself is left out: the law is about either side.
          steps: fc.array(fc.integer({ min: 0, max: 2500 }), { minLength: 4, maxLength: 4 }),
        }),
        ({ pending, steps }) => {
          const clock = [0];

          for (const step of steps) {
            clock.push(clock.at(-1)! + step);
          }

          const seconds = clock.map((t) => (t === 3600 ? 3601 : t));
          // The green answer is the check read after the pending ones.
          const late = seconds[pending + 1]! >= 3600;
          const got = run({ ...green, pending, clock: seconds });
          expect(got.code, got.text).toBe(late ? 1 : 0);
          expect(merges(got.calls)).toHaveLength(late ? 0 : 1);

          if (late) {
            expect(got.text).toMatch(/not done .* after an hour/);
          } else {
            expect(got.text).not.toContain("after an hour");
          }

          assertHead(got.calls);
        },
      ),
      {
        ...options,
        // pinned: ticket 520 review round 4, a green answer at 3,601 seconds still merged.
        examples: [[{ pending: 0, steps: [3601, 0, 0, 0] }]],
      },
    );
  });

  // Plant: push a branch twice, or continue after either push is refused.
  it("each push sends its intended refs once and refusal stops", () => {
    fc.assert(
      fc.property(
        fc.record({
          bot: fc.boolean(),
          suffix: fc.nat({ max: 99 }),
          merge: fc.boolean(),
          refused: fc.constantFrom<Setup["refused"]>("none", "notes", "branch"),
        }),
        ({ bot, suffix, merge, refused: outcome }) => {
          for (const refused of new Set<Setup["refused"]>(["none", outcome])) {
            const branch = `${bot ? "fabrikalfa" : "person"}/tests-${suffix}`;
            const got = run({ ...green, branch, merge, refused });
            const denied = merge && refused !== "none";
            expect(got.code, got.text).toBe(denied ? 1 : 0);
            const botpush = got.calls.filter((c) => c.cmd === "node" && c.args[0]!.endsWith("/botpush.mjs"));
            expect(botpush.map((c) => c.args.slice(1))).toEqual(
              !merge ? [] : bot ? [[".", branch, tip]] : [[".", "-"]],
            );
            const pushes = got.calls.filter((c) => c.cmd === "git" && c.args[0] === "push");
            expect(pushes.map((c) => c.args)).toEqual(
              merge && !bot && refused !== "notes" ? [["push", "-q", "origin", `${tip}:refs/heads/${branch}`]] : [],
            );
            expect(merges(got.calls)).toHaveLength(denied ? 0 : 1);
            assertHead(got.calls);
          }
        },
      ),
      { ...options, numRuns: 8 },
    );
  });
});

// 0015: a merged PR closes only the tickets its description names, one line each, in our own
// phrase. GitHub's keywords, trailers and other text never close one.
describe("catchup closes the tickets a merged PR names, today's tooling", () => {
  const phrase = /^[ \t]*fabrika close ticket [0-9]+[ \t]*$/;
  const note = () => `Closed by the merge of https://github.com/fixture/repo/pull/900, merge commit ${merged}.\n`;
  const closes = (posts: Post[]) => posts.filter((p) => p.sub !== "list");
  const noise = fc.stringMatching(/^[^\r\n]{0,30}$/).filter((line) => !phrase.test(line));

  // Plant: match the phrase anywhere on a line, or close the ticket the PR was signed for.
  it("T410 property: a description with no phrase line closes nothing", () => {
    fc.assert(
      fc.property(fc.array(noise, { maxLength: 6 }), (lines) => {
        const got = run({ ...green, body: lines.join("\n"), tickets: { 520: "open", 5: "open" } });
        expect(got.code, got.text).toBe(0);
        expect(got.posts).toEqual([]);
        expect(got.text).toContain("pr 900: no fabrika close ticket line; closed no tickets");
      }),
      { seed: 4101, numRuns: 6 },
    );
  });

  // Plant: read GitHub's closing keywords, or a ticket trailer, as a close.
  it("T410 vector: GitHub's nine closing keywords and ticket trailers close nothing (GitHub docs, linking a pull request to an issue)", () => {
    const keywords = ["close", "closes", "closed", "fix", "fixes", "fixed", "resolve", "resolves", "resolved"];
    const body = [
      ...keywords.flatMap((k) => [`${k} #5`, `${k[0]!.toUpperCase()}${k.slice(1)} #5`, `${k}: 5`]),
      "Ticket: 5",
      "Closes-ticket: 5",
      "T5 build: the fix",
    ].join("\n");
    const got = run({ ...green, body, tickets: { 5: "open" } });
    expect(got.code, got.text).toBe(0);
    expect(got.posts).toEqual([]);
  });

  // Plant: accept the phrase with other text before or after it on the line.
  it("T410 property: the phrase inside other text on its line closes nothing", () => {
    fc.assert(
      fc.property(fc.stringMatching(/^[a-z.:#`>*-]{1,8}$/), fc.boolean(), (other, before) => {
        const line = before ? `${other} fabrika close ticket 5` : `fabrika close ticket 5${other}`;
        const got = run({ ...green, body: `Done.\n${line}\n`, tickets: { 5: "open" } });
        expect(got.code, got.text).toBe(0);
        expect(got.posts).toEqual([]);
      }),
      { seed: 4102, numRuns: 6 },
    );
  });

  // Plant: close only the first line's ticket, skip the comment, or close one already closed.
  it("T410 property: each phrase line closes its open ticket once, with a comment naming the PR and the merge commit", () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.integer({ min: 1, max: 999 }), { minLength: 1, maxLength: 3 }),
        fc.array(fc.boolean(), { minLength: 3, maxLength: 3 }),
        fc.array(fc.constantFrom("", " ", "\t", "  "), { minLength: 2, maxLength: 2 }),
        fc.boolean(),
        fc.array(noise, { maxLength: 2 }),
        (named, open, [lead, trail], crlf, other) => {
          const tickets = Object.fromEntries(
            named.map((n, i) => [n, open[i] ? ("open" as const) : ("closed" as const)]),
          );
          const lines = [...other, ...named.map((n) => `${lead}fabrika close ticket ${n}${trail}`)];
          // A repeated line closes its ticket once.
          lines.push(`fabrika close ticket ${named[0]}`);
          const got = run({ ...green, body: lines.join(crlf ? "\r\n" : "\n"), tickets });
          expect(got.code, got.text).toBe(0);
          expect(got.posts[0]).toMatchObject({ sub: "list", as: "lead" });
          expect(closes(got.posts)).toEqual(
            named.flatMap((n) =>
              tickets[n] === "open"
                ? [
                    { sub: "comment", ticket: n, as: "lead", home: got.posts[0]!.home, body: note() },
                    { sub: "close", ticket: n, as: "lead", home: got.posts[0]!.home },
                  ]
                : [],
            ),
          );

          for (const n of named) {
            expect(got.text).toContain(
              tickets[n] === "open"
                ? `pr 900: closed ticket ${n}\n`
                : `pr 900: ticket ${n} is not open (already closed, or no such ticket); left as it is`,
            );
          }

          expect(got.posts.every((p) => p.home.endsWith("/fh"))).toBe(true);
        },
      ),
      { seed: 4103, numRuns: 8 },
    );
  });

  // Plant: stop after the first ticket.
  it("T410 scenario: two phrase lines close two tickets (the decision's own example)", () => {
    const got = run({
      ...green,
      body: "Builds the close.\n\nfabrika close ticket 410\nfabrika close ticket 411\n",
      tickets: { 410: "open", 411: "open" },
    });
    expect(got.code, got.text).toBe(0);
    expect(closes(got.posts).map((p) => [p.sub, p.ticket])).toEqual([
      ["comment", 410],
      ["close", 410],
      ["comment", 411],
      ["close", 411],
    ]);
    expect(got.text).toContain("pr 900: closed ticket 410\npr 900: closed ticket 411\n");
  });

  // Plant: read the description before the merge, or close when GitHub does not say MERGED or
  // the merge commit is not on main.
  it("T410 scenario: a refused, unconfirmed or off-main merge closes nothing", () => {
    const body = "fabrika close ticket 5";
    const refused = run({ ...green, mergeFails: true, body, tickets: { 5: "open" } });
    expect(refused.code, refused.text).toBe(1);
    expect(refused.posts).toEqual([]);
    expect(refused.calls.filter((c) => c.key === "landed" || c.key === "body")).toEqual([]);
    const open = run({ ...green, landed: "OPEN", body, tickets: { 5: "open" } });
    expect(open.code, open.text).toBe(0);
    expect(open.posts).toEqual([]);
    expect(open.calls.filter((c) => c.key === "landed")).toHaveLength(10);
    expect(open.calls.filter((c) => c.key === "body")).toEqual([]);
    expect(open.text).toContain("pr 900: not confirmed merged (OPEN); closed no tickets");
    const off = run({ ...green, offMain: true, body, tickets: { 5: "open" } });
    expect(off.code, off.text).toBe(0);
    expect(off.posts).toEqual([]);
    expect(off.text).toContain(`pr 900: merge commit ${merged} is not on main; closed no tickets`);
  });
});

// A catch-up on a pull request that is not open and ready ends at once, with one line, and every
// wait has a bound (a waiter left on a merged pull request ran for an hour, 2026-11-11). Edge
// cases, each with its law below: merged before the start; merged, closed or made a draft by
// someone else during the wait; closed unmerged; a draft; one failed state read (network) against
// a pull request GitHub does not know; and a wait reaching its bound. The checks' own bound is the
// law "no merge once the clock is past the hour" above.
describe("catchup ends on a pull request that is not open, today's tooling", () => {
  const ending = {
    MERGED: { code: 0, line: `pr 900: already merged at ${merged}` },
    CLOSED: { code: 1, line: "pr 900: closed, not merged" },
    DRAFT: { code: 1, line: "pr 900: draft, not merged" },
  } as const;
  const touches = (calls: ReturnType<typeof run>["calls"]) =>
    calls.filter(
      (c) =>
        (c.cmd === "git" && ["fetch", "checkout", "push", "merge"].some((a) => c.args.includes(a))) ||
        (c.cmd === "node" && c.args[0]!.endsWith("/botpush.mjs")) ||
        c.cmd === "pnpm" ||
        c.cmd === "nice" ||
        ["checks", "merge", "stack", "rest"].includes(c.key ?? ""),
    );

  // Plants: read the state after the fetch; treat MERGED as an error or CLOSED as done; let a
  // draft wait on the checks.
  it("property: a pull request merged, closed or a draft at the start ends before any fetch, push, check read or merge", () => {
    fc.assert(
      fc.property(
        fc.record({
          view: fc.constantFrom<keyof typeof ending>("MERGED", "CLOSED", "DRAFT"),
          merge: fc.boolean(),
          bot: fc.boolean(),
        }),
        ({ view, merge, bot }) => {
          const got = run({ ...green, merge, branch: bot ? "fabrikalfa/tests-1" : "person/x", views: [view] });
          expect(got.code, got.text).toBe(ending[view].code);
          expect(got.text).toContain(ending[view].line);
          expect(got.text.split("\n").filter((l) => l.startsWith("pr 900:"))).toHaveLength(1);
          expect(touches(got.calls)).toEqual([]);
          expect(got.calls.filter((c) => c.key === "head")).toHaveLength(1);
        },
      ),
      { seed: 1101, numRuns: 8 },
    );
  });

  // Plants: look only once before the wait; keep reading checks after the PR is merged or closed;
  // squash a PR that someone else merged.
  it("property: merged, closed or made a draft during the wait ends at that look, with no check read or merge after it", () => {
    fc.assert(
      fc.property(
        fc.record({
          view: fc.constantFrom<keyof typeof ending>("MERGED", "CLOSED", "DRAFT"),
          opens: fc.integer({ min: 0, max: 3 }),
        }),
        ({ view, opens }) => {
          // The start read and `opens` looks see it open, with the checks still running.
          const views: View[] = [...Array.from({ length: opens + 1 }, () => "OPEN" as const), view];
          const got = run({ ...green, pending: 5, views });
          expect(got.code, got.text).toBe(ending[view].code);
          expect(got.text).toContain(ending[view].line);
          expect(got.calls.filter((c) => c.key === "standing")).toHaveLength(opens + 1);
          expect(got.calls.filter((c) => c.key === "checks")).toHaveLength(opens);
          const last = got.calls.map((c) => c.key).lastIndexOf("standing");
          expect(got.calls.slice(last + 1).filter((c) => c.cmd === "gh")).toEqual([]);
          expect(merges(got.calls)).toHaveLength(0);
          assertHead(got.calls);
        },
      ),
      { seed: 1102, numRuns: 8 },
    );
  });

  // Plant: print "merge refused" when the squash fails because someone else just merged it.
  it("scenario: a squash refused because the PR was merged or closed in the meantime says so (the race after the last look)", () => {
    for (const view of ["MERGED", "CLOSED"] as const) {
      // The start read and the one look in the wait see it open; the look after the refusal does not.
      const got = run({ ...green, mergeFails: true, views: ["OPEN", "OPEN", view] });
      expect(got.code, got.text).toBe(ending[view].code);
      expect(got.text).toContain(ending[view].line);
      expect(got.text).not.toContain("merge refused");
    }

    const open = run({ ...green, mergeFails: true });
    expect(open.code, open.text).toBe(1);
    expect(open.text).toContain("pr 900: merge refused");
  });

  // Plants: retry a pull request GitHub does not know; stop on one failed look.
  it("scenario: a failed state read is retried as the network, and a pull request GitHub does not know stops at once (gh says 'Could not resolve to a PullRequest')", () => {
    const unknown = run({ ...green, views: ["UNKNOWN"] });
    expect(unknown.code, unknown.text).toBe(1);
    expect(unknown.text).toContain("pr 900: no such pull request in fixture/repo");
    expect(unknown.calls.filter((c) => c.key === "head")).toHaveLength(1);
    expect(unknown.calls.filter((c) => c.cmd === "sleep")).toEqual([]);
    expect(touches(unknown.calls)).toEqual([]);

    for (const lookFailures of [1, 2]) {
      const got = run({ ...green, lookFailures });
      expect(got.code, got.text).toBe(0);
      expect(got.calls.filter((c) => c.key === "standing")).toHaveLength(lookFailures + 1);
      expect(merges(got.calls)).toHaveLength(1);
    }

    const down = run({ ...green, lookFailures: 3 });
    expect(down.code, down.text).toBe(1);
    expect(down.text).toContain("failed after 3 attempts");
    expect(merges(down.calls)).toHaveLength(0);
  });

  // Plants: wait on the lock forever; remove a lock another run holds; give up before the hour.
  it("property: a lock another run holds is waited on for an hour at most, then the run ends with a line naming it and leaves the lock", () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 1, max: 1700 }), { minLength: 1, maxLength: 4 }), (steps) => {
        const clock = [0];

        for (const step of steps) {
          clock.push(clock.at(-1)! + step);
        }

        // The last answer is past the hour, so every case reaches the bound.
        clock.push(clock.at(-1)! + 3600);
        const got = run({ ...green, lockHeld: clock });
        const late = clock.findIndex((t) => t >= 3600);
        expect(got.code, got.text).toBe(1);
        expect(got.text).toMatch(/^pr 900: waited an hour for the catch-up lock .*catchup\.lock; nothing done$/m);
        // The first date sets the deadline; each later one before it is one more wait.
        expect(got.calls.filter((c) => c.cmd === "sleep")).toHaveLength(late - 1);
        expect(got.calls.filter((c) => c.cmd === "gh")).toEqual([]);
      }),
      { seed: 1105, numRuns: 6 },
    );
  });

  // Plant: print a red job's name without its link.
  it("property: a red job prints with its link beside its name", () => {
    fc.assert(
      fc.property(fc.constantFrom("check", "e2e", "commits", ...nextNames), (name) => {
        const checks = matrixChecks.map((c) =>
          c.name === name ? { ...c, conclusion: "failure", url: link(name) } : { ...c, url: link(c.name) },
        );
        const got = run({ ...green, checks });
        expect(got.code, got.text).toBe(1);
        expect(got.text).toContain(`pr 900: red at ${tip}: ${name}: failure, ${link(name)}`);
        expect(merges(got.calls)).toHaveLength(0);
      }),
      { seed: 1106, numRuns: 4 },
    );
    // A check run with no link still prints its name and conclusion as before.
    const bare = run({ ...green, answer: "red" });
    expect(bare.text).toMatch(new RegExp(`^pr 900: red at ${tip}: check: failure$`, "m"));
    const linked = run({ ...green, answer: "red", links: true });
    expect(linked.text).toContain(`pr 900: red at ${tip}: check: failure, ${link("check")}`);
  });
});
