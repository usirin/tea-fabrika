// gcloop.ts: the box garbage collection loop (decision 0101). Today's lead tooling. The pure laws
// read gc's printed lines, the status line and the unit file; the sweep laws run real sweeps in a
// temp state folder with a stand-in for `box.sh gc`: no box, git, gh or Docker is touched.
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "./gcloop.ts?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "./box.sh?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "./box.ts?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "./box/BoxGitProcess.ts?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "./box/Remove.ts?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "./box/RunsProcess.ts?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "./box/BoxGit.ts?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "./box/Runs.ts?raw";
import "./env.sh?raw";
import "./fieldrow.py?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "./gc.ts?raw";
import "./keepruns.sh?raw";
import "./redact.sh?raw";
import "../../plan/scripts/plancheck.sh?raw";
import "../../step-commit/scripts/exam.py?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "./flow/Beat.ts?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "./botpush.mjs?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "./lane.ts?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "./mutbox.ts?raw";
import "./leakgrep.sh?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "./sizecap.ts?raw";
import "../../step-commit/scripts/stepcommit.sh?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "./drive.ts?raw";
import "./mutbox-entry.sh?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "./mutbox.Dockerfile?raw";
import "../../mutation/scripts/run.sh?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "../../mutation/scripts/sample.ts?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "./agents.ts?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "./pgrep.ts?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "../../mutation/scripts/limit.ts?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "../../mutation/scripts/scope.ts?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "./boxnode.ts?raw";
import "./clauderow.py?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "./codexexec.ts?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "./runid.ts?raw";
import { NodeServices } from "@effect/platform-node";
import { Duration, Effect, FileSystem, Result, Schema, type Scope } from "effect";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { Holder, fill, late, newest, readOutput, says, Sweep, sweep, sweeps, Outcome } from "./gcloop.ts";

const options = { seed: 119120, numRuns: 200 };
const MIN = 60_000;

const ran = <A, E>(law: Effect.Effect<A, E, NodeServices.NodeServices | Scope.Scope>) =>
  // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: Vitest awaits the Promise a test hands back
  Effect.runPromise(law.pipe(Effect.scoped, Effect.provide(NodeServices.layer)));

/** A temp state folder, given back when the law ends. */
const temp = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  return yield* Effect.acquireRelease(fs.makeTempDirectory({ prefix: "gcloop-" }), (dir) =>
    fs.remove(dir, { recursive: true, force: true }).pipe(Effect.ignore),
  );
});

const TOTAL = "gc: removed 0 boxes and 0 worktrees, 0 MB; kept 0";

const ask = (state: string, gc: ReadonlyArray<string>, pid = process.pid) => ({
  state,
  gc,
  trigger: "hand" as const,
  minutes: 30,
  limit: Duration.seconds(20),
  pid,
});

const sweepAt = (startedAt: number, outcome: Outcome = Outcome.cases.ok.make({})): Sweep =>
  Sweep.make({
    startedAt: new Date(startedAt).toISOString(),
    endedAt: new Date(startedAt + 1000).toISOString(),
    ms: 1000,
    trigger: "timer",
    minutes: 30,
    pid: 1,
    outcome,
    code: outcome._tag === "skipped" ? null : 0,
    removed: { boxes: [], worktrees: [], facts: [] },
    kept: [],
    seen: 0,
    freedMb: 0,
    freeKb: { before: null, after: null },
    mutbox: null,
  });

describe("readOutput", () => {
  const name = fc.stringMatching(/^[a-z][a-z0-9-]{0,11}$/);
  const path = fc.stringMatching(/^\/[a-z][a-z0-9/-]{0,20}$/);
  const mb = fc.nat({ max: 5000 });

  // Plant: miss a line kind, count a keep as removed, or sum the MB wrong.
  it("format: every box, worktree, fact and keep gc prints is read back, with the MB it freed", () => {
    fc.assert(
      fc.property(
        fc.array(fc.tuple(name, fc.constantFrom("merged", "on_remote", "backed up to fabrikalfa/x-wip"), mb)),
        fc.array(fc.tuple(path, fc.constantFrom("merged", "closed"), mb)),
        fc.array(name),
        fc.array(fc.tuple(name, fc.constantFrom("touched 3 min ago", "3 uncommitted files"))),
        (boxes, trees, facts, keeps) => {
          const lines = [
            ...keeps.map(([n, reason]) => `keep ${n}: ${reason}`),
            ...boxes.map(([n, reason, m]) => `removed ${n}: ${reason}, ${m} MB`),
            ...facts.map((f) => `removed state/${f}.box: its box is gone`),
            ...trees.map(([p, reason, m]) => `removed worktree ${p}: ${reason}, ${m} MB`),
            TOTAL,
          ];
          const read = readOutput(lines.join("\n"));
          expect(read.removed.boxes).toEqual(boxes.map(([n]) => n));
          expect(read.removed.worktrees).toEqual(trees.map(([p]) => p));
          expect(read.removed.facts).toEqual(facts.map((f) => `${f}.box`));
          expect(read.kept).toEqual(keeps.map(([n, reason]) => `${n}: ${reason}`));
          expect(read.freedMb).toBe([...boxes, ...trees].reduce((n, [, , m]) => n + m, 0));
          expect(read.seen).toBe(boxes.length + trees.length + keeps.length);
        },
      ),
      options,
    );
  });

  // vector: gc's real dry-run and mutbox lines remove nothing.
  it("vector: a dry run's would-remove lines and mutbox's stop line are not removals", () => {
    const read = readOutput(
      [
        "would remove t1-build1: merged, 12 MB",
        "mutbox gc: stopped after 30 s (spawnSync node ETIMEDOUT); the rest waits for the next gc",
        TOTAL,
      ].join("\n"),
    );
    expect(read.removed).toEqual({ boxes: [], worktrees: [], facts: [] });
    expect(read.mutbox).toContain("mutbox gc: stopped after 30 s");
  });
});

describe("the status line", () => {
  // Plant: LATE at one period, at exactly two, or only when nothing is recorded.
  it("LATE exactly when the newest sweep that ran started more than two periods ago", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 10 ** 12, max: 2 * 10 ** 12 }),
        fc.integer({ min: 1, max: 240 }),
        fc.integer({ min: 0, max: 600 * MIN }),
        fc.nat({ max: 3 }),
        (now, minutes, age, skips) => {
          const records = [
            sweepAt(now - age),
            ...Array.from({ length: skips }, (_, i) =>
              sweepAt(now - i, Outcome.cases.skipped.make({ reason: "a sweep is going" })),
            ),
          ];
          const line = says(records, now, minutes);
          const want = age > 2 * minutes * MIN;
          expect(late(records[0] ?? null, now, minutes)).toBe(want);
          expect(line.late).toBe(want);
          expect(line.text.startsWith("gc: LATE: ")).toBe(want);
          expect(line.text.includes(`${skips} skipped since`)).toBe(skips > 0);
        },
      ),
      options,
    );
  });

  // Plant: count a skipped sweep as the last one that ran, so a hung lock never reads as late.
  it("a skipped sweep is never the last one that ran, and with only skips the loop is LATE", () => {
    fc.assert(
      fc.property(fc.array(fc.boolean(), { maxLength: 8 }), (ranOrSkipped) => {
        const records = ranOrSkipped.map((ranIt, i) =>
          sweepAt(i * MIN, ranIt ? Outcome.cases.ok.make({}) : Outcome.cases.skipped.make({ reason: "x" })),
        );
        const at = ranOrSkipped.lastIndexOf(true);
        expect(newest(records)).toEqual({ last: at < 0 ? null : records[at], skipped: records.length - 1 - at });
        expect(says(records, 0, 30).late).toBe(at < 0 || late(records[at] ?? null, 0, 30));
      }),
      options,
    );
  });

  // vector: the words a person reads, ok and failed.
  it("vector: one ok and one failed sweep read as plain lines", () => {
    const now = Date.parse("2026-11-11T12:00:00Z");
    const ok = Sweep.make({
      ...sweepAt(now - 12 * MIN),
      removed: { boxes: ["a", "b"], worktrees: ["/w"], facts: [] },
      kept: ["c: touched 3 min ago"],
      freedMb: 840,
    });
    expect(says([ok], now, 30).text).toBe(
      "gc: last swept 12m ago (timer), ok in 1s, removed 2 boxes and 1 worktree, 840 MB; kept 1; every 30m",
    );
    const failed = sweepAt(now - 70 * MIN, Outcome.cases.failed.make({ reason: "box.sh gc exited 1: gh down" }));
    expect(
      says([failed], now, 30, Holder.make({ pid: 7, startedAt: new Date(now - 5 * MIN).toISOString() })).text,
    ).toBe(
      "gc: LATE: last swept 1h10m ago (timer), failed in 1s: box.sh gc exited 1: gh down; every 30m; one going for 5m (pid 7)",
    );
    expect(says([], now, 30).text).toBe("gc: LATE: no sweep recorded; every 30m");
  });
});

describe("a sweep", () => {
  const echo = (text: string, code = 0, wait = 0) => [
    "sh",
    "-c",
    `sleep ${wait}; printf '%s\\n' "$0"; echo planted-error >&2; exit ${code}`,
    text,
  ];

  // Plant: no lock, a lock taken after gc started, or a lock that a second start ignores.
  // Live pids, so each holder counts as alive: this process, its parent, and launchd.
  const pids = [process.pid, process.ppid, 1];

  it("no overlap: of sweeps started together, exactly one runs and the rest record skipped", () =>
    fc.assert(
      fc.asyncProperty(fc.integer({ min: 2, max: 3 }), (n) =>
        ran(
          Effect.gen(function* () {
            const state = yield* temp;
            const done = yield* Effect.all(
              pids.slice(0, n).map((pid) => sweep(ask(state, echo(TOTAL, 0, 0.4), pid))),
              { concurrency: "unbounded" },
            );
            const tags = done.map((s) => s.outcome._tag).sort();
            expect(tags).toEqual(["ok", ...Array.from({ length: n - 1 }, () => "skipped")]);
            expect((yield* sweeps(state)).length).toBe(n);
            const fs = yield* FileSystem.FileSystem;
            expect(yield* fs.exists(`${state}/gc.lock`)).toBe(false);
            // Once it ended, the next start runs.
            expect((yield* sweep(ask(state, echo(TOTAL)))).outcome._tag).toBe("ok");
          }),
        ),
      ),
      { seed: 119120, numRuns: 4 },
    ));

  // Plant: write the record only on success, or drop what gc removed before it failed.
  it("scenario: a failed, missing or hung gc still writes its record, and gives the lock back", () =>
    ran(
      Effect.gen(function* () {
        const state = yield* temp;
        const failed = yield* sweep(ask(state, echo("removed a1: merged, 3 MB", 1)));
        expect(failed.outcome).toEqual(Outcome.cases.failed.make({ reason: "box.sh gc exited 1: planted-error" }));
        expect(failed.code).toBe(1);
        expect(failed.removed.boxes).toEqual(["a1"]);
        const missing = yield* sweep(ask(state, ["/no/such/gc"]));
        expect(missing.outcome._tag).toBe("failed");
        const hung = yield* sweep({ ...ask(state, echo(TOTAL, 0, 5)), limit: Duration.seconds(1) });
        expect(hung.outcome).toEqual(Outcome.cases.failed.make({ reason: "stopped after 1s; the next sweep goes on" }));
        expect(hung.ms).toBeLessThan(4500);
        expect((yield* sweeps(state)).map((s) => s.outcome._tag)).toEqual(["failed", "failed", "failed"]);
        const fs = yield* FileSystem.FileSystem;
        expect(yield* fs.exists(`${state}/gc.lock`)).toBe(false);
      }),
    ));

  // Plant: take a live sweep's lock, keep a dead one's for good, or skip without a record.
  it("scenario: a live holder's lock skips with its pid; a dead or two-period-old one is taken over", () =>
    ran(
      Effect.gen(function* () {
        const state = yield* temp;
        const fs = yield* FileSystem.FileSystem;
        const write = (holder: Holder) =>
          fs.writeFileString(`${state}/gc.lock`, Schema.encodeSync(Schema.fromJsonString(Holder))(holder));
        const now = Date.now();

        yield* write(Holder.make({ pid: 1, startedAt: new Date(now).toISOString() }));
        const skipped = yield* sweep(ask(state, echo(TOTAL)));
        expect(skipped.outcome._tag).toBe("skipped");
        expect(skipped.outcome._tag === "skipped" && skipped.outcome.reason).toContain("pid 1,");
        expect(yield* fs.exists(`${state}/gc.lock`)).toBe(true);

        yield* write(Holder.make({ pid: 99_999_999, startedAt: new Date(now).toISOString() }));
        expect((yield* sweep(ask(state, echo(TOTAL)))).outcome._tag).toBe("ok");

        yield* write(Holder.make({ pid: 1, startedAt: new Date(now - 61 * MIN).toISOString() }));
        expect((yield* sweep(ask(state, echo(TOTAL)))).outcome._tag).toBe("ok");

        yield* fs.writeFileString(`${state}/gc.lock`, "not a holder");
        expect((yield* sweep(ask(state, echo(TOTAL)))).outcome._tag).toBe("ok");
        expect(yield* fs.exists(`${state}/gc.lock`)).toBe(false);
        expect((yield* fs.readDirectory(state)).sort()).toEqual(["gc.jsonl"]);
      }),
    ));

  // Plant: a torn line hides every sweep after it.
  it("scenario: a line that is not a sweep is left out and the rest still read", () =>
    ran(
      Effect.gen(function* () {
        const state = yield* temp;
        yield* sweep(ask(state, echo(TOTAL)));
        const fs = yield* FileSystem.FileSystem;
        yield* fs.writeFileString(`${state}/gc.jsonl`, '{"torn": \n', { flag: "a" });
        yield* sweep(ask(state, echo(TOTAL)));
        expect((yield* sweeps(state)).length).toBe(2);
      }),
    ));
});

describe("the timer's unit", () => {
  const template = (dir: string) =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      return yield* fs.readFileString(`${dir}/../gc.plist`);
    });

  // Plant: leave a mark, skip the escape, or commit a machine path.
  it("property: every mark is filled and XML-escaped, and a missing value names its mark", () => {
    fc.assert(
      fc.property(fc.string(), fc.string(), (a, b) => {
        const filled = fill("<s>{{a}}</s><s>{{b}}</s>", { a, b });
        const esc = (t: string) =>
          t.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
        expect(filled).toEqual(Result.succeed(`<s>${esc(a)}</s><s>${esc(b)}</s>`));
        expect(fill("{{a}} {{c}}", { a })).toEqual(Result.fail("the unit file has no value for {{c}}"));
      }),
      options,
    );
  });

  it("scenario: the committed unit names no machine path and fills with the timer's own values", () =>
    ran(
      Effect.gen(function* () {
        const text = yield* template(import.meta.dirname);
        expect(text).not.toMatch(/\/Users\/|\/home\/|\$HOME/);
        const filled = fill(text, {
          label: "local.tea-fabrika.gc",
          node: "/n",
          script: "/s/gcloop.ts",
          main: "/m",
          minutes: "30",
          seconds: "1800",
          path: "/usr/bin:/bin",
          log: "/l/gc-timer.log",
        });
        expect(Result.isSuccess(filled)).toBe(true);
        const unit = Result.getOrElse(filled, () => "");
        expect(unit).toContain("<key>StartInterval</key>\n  <integer>1800</integer>");
        expect(unit).toContain("<string>/s/gcloop.ts</string>\n    <string>sweep</string>");
        expect(unit).toContain("<string>timer</string>");
      }),
    ));
});
