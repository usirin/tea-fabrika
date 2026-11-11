// The host step's parts, on Node in a temp folder: the brief's commands, the Electron lock, the
// time limit, what a failed command answers, and the lane's state file. Commands here are plain
// `sh` lines; no git, Electron, network or agent runs.
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "../agents.ts?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "../botpush.mjs?raw";
import "../box.sh?raw";
import "../catchup.sh?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "../chain.ts?raw";
import "../clauderow.py?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "../drive.ts?raw";
import "../env.sh?raw";
import "../fieldrow.py?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "../freshmain.ts?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "../gc.ts?raw";
import "../keepruns.sh?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "../lane.ts?raw";
import "../leakgrep.sh?raw";
import "../loosening.sh?raw";
import "../mutbox-entry.sh?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "../mutbox.Dockerfile?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "../mutbox.ts?raw";
import "../redact.sh?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "../sizecap.ts?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "./Outcome.ts?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "./Runners.ts?raw";
import "../../../mutation/scripts/run.sh?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "../../../mutation/scripts/sample.ts?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "../../../mutation/scripts/scope.ts?raw";
import "../../../plan/scripts/plancheck.sh?raw";
import "../../../step-commit/scripts/exam.py?raw";
import "../../../step-commit/scripts/stepcommit.sh?raw";
import { NodeServices } from "@effect/platform-node";
import { Effect, Fiber, FileSystem, Option, Ref, type Scope } from "effect";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  changedPaths,
  commandArgv,
  electronLock,
  host,
  hostCommands,
  hostEnv,
  lastHost,
  recordInLane,
  repoNode,
  runCommands,
  runners,
} from "./host.ts";
import * as Step from "./Step.ts";

const ran = <A, E>(law: Effect.Effect<A, E, NodeServices.NodeServices | Scope.Scope>) =>
  // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: Vitest awaits the Promise a test hands back
  Effect.runPromise(law.pipe(Effect.scoped, Effect.provide(NodeServices.layer)));

const options = { seed: 119120, numRuns: 200 };

const temp = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  return yield* fs.makeTempDirectoryScoped({ prefix: "host-" });
});

const command = fc.stringMatching(/^[a-z][a-z0-9 ./=-]{0,40}$/).filter((c) => c === c.trim());
const sha = "a".repeat(40);

const args = (commands: ReadonlyArray<string>) => ({
  main: "/nowhere/main",
  boxes: "/nowhere/boxes",
  lane: "lane",
  ticket: "7",
  branch: "fabrikalfa/lane",
  plan: "/nowhere/plan.md",
  head: sha,
  round: 3,
  commands,
  minutes: 1,
});

describe("the lane brief's host commands", () => {
  it("property: only the lines inside a fence run, in order, without blanks and comments; prose never runs", () => {
    fc.assert(
      fc.property(fc.array(command, { maxLength: 6 }), fc.array(command, { maxLength: 4 }), (inside, prose) => {
        const section = [...prose, "```sh", "# a comment", ...inside.flatMap((c) => [c, ""]), "```", ...prose].join(
          "\n",
        );
        expect(hostCommands(section)).toEqual(inside);
      }),
      options,
    );
  });

  it("vector: no section, an empty one, and one with prose only name no command", () => {
    expect(hostCommands(undefined)).toEqual([]);
    expect(hostCommands("")).toEqual([]);
    expect(hostCommands("run the e2e on the host")).toEqual([]);
  });

  it("pinned: every command gets its own home and temp folder, and no foreground window or paid key", () => {
    expect(hostEnv("/tmp/fhX")).toEqual({
      FABRIKA_HOME: "/tmp/fhX/home",
      TMPDIR: "/tmp/fhX",
      FABRIKA_FOREGROUND: undefined,
      TYPESAFE_API_KEY: undefined,
    });
  });

  it("pinned: a command runs under the repo's Node through volta, since apps/fabrika names none of its own", () => {
    expect(commandArgv("node e2e.ts", "26.13.0")).toEqual([
      "volta",
      "run",
      "--node",
      "26.13.0",
      "sh",
      "-c",
      "node e2e.ts",
    ]);
    expect(commandArgv("node e2e.ts", null)).toEqual(["sh", "-c", "node e2e.ts"]);
  });

  it("vector: the repo's Node is volta.node, else engines.node, and a range or no pin is none", () =>
    ran(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const node = (pkg: unknown) =>
          Effect.gen(function* () {
            const dir = yield* temp;
            yield* fs.writeFileString(`${dir}/package.json`, JSON.stringify(pkg));
            return yield* repoNode(dir);
          });
        expect(yield* node({ volta: { node: "26.13.0" }, engines: { node: "26.1.0" } })).toBe("26.13.0");
        expect(yield* node({ engines: { node: "26.13.0" } })).toBe("26.13.0");
        expect(yield* node({ engines: { node: ">=22" } })).toBeNull();
        expect(yield* node({ name: "x" })).toBeNull();
        expect(yield* repoNode(yield* temp)).toBeNull();
      }),
    ));

  it("vector: git status -z gives one path per changed file", () => {
    expect(changedPaths(" M a/b.png\0?? docs/c d.png\0 D old.png\0")).toEqual(["a/b.png", "docs/c d.png", "old.png"]);
    expect(changedPaths("")).toEqual([]);
  });
});

describe("the host step's outcomes", () => {
  it("scenario: a lane brief with no host section is a skip that touches nothing, since most lanes have no window", () =>
    ran(
      Effect.gen(function* () {
        const hosted = yield* host(args([]));
        expect(hosted).toEqual({ outcome: expect.objectContaining({ _tag: "skip" }), head: sha, log: null });
      }),
    ));

  it("scenario: the flow runner's host step answers skip for no commands, and refuses args that do not parse", () =>
    ran(
      Effect.gen(function* () {
        const runner = runners.host ?? (() => Effect.die("no host runner"));
        const answer = yield* runner(Step.act("host", args([])));
        expect(answer.outcome._tag).toBe("skip");
        const failed = yield* runner(Step.act("host", { ...args([]), head: "HEAD" })).pipe(Effect.flip);
        expect(failed.reason).toContain("args do not parse");
      }),
    ));

  it("property: the first command that exits non-zero sends the lane to build with its last lines, and no later command runs", () =>
    fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 125 }), fc.stringMatching(/^[a-z]{4,12}$/), (code, said) =>
        ran(
          Effect.gen(function* () {
            const dir = yield* temp;
            const log = `${dir}/log`;
            const outcome = yield* runCommands(dir, ["true", `echo ${said}; exit ${code}`, "touch later"], {}, log, 1);
            expect(outcome).toMatchObject({ _tag: "send", to: "build" });
            expect(outcome?.reason).toContain(`exited ${code}`);
            expect(outcome?.reason).toContain(said);
            const fs = yield* FileSystem.FileSystem;
            expect(yield* fs.exists(`${dir}/later`)).toBe(false);
          }),
        ),
      ),
      { ...options, numRuns: 10 },
    ));

  it("scenario: every command exits 0, in the folder, with the host env, and the answer is null", () =>
    ran(
      Effect.gen(function* () {
        const dir = yield* temp;
        const outcome = yield* runCommands(
          dir,
          ['printf "%s|" "$FABRIKA_HOME" > env.txt; env | grep -c "^FABRIKA_FOREGROUND=" >> env.txt || true'],
          hostEnv(dir),
          `${dir}/log`,
          1,
        );
        expect(outcome).toBeNull();
        const fs = yield* FileSystem.FileSystem;
        expect(yield* fs.readFileString(`${dir}/env.txt`)).toBe(`${dir}/home|0\n`);
      }),
    ));

  it("scenario: a command past its time limit is stopped and sends the lane to build, since a hung app must not hold the lock", () =>
    ran(
      Effect.gen(function* () {
        const dir = yield* temp;
        const started = Date.now();
        // 0.002 minutes is 120 ms.
        const outcome = yield* runCommands(dir, ["echo begun; sleep 30"], {}, `${dir}/log`, 0.002);
        expect(Date.now() - started).toBeLessThan(10_000);
        expect(outcome).toMatchObject({ _tag: "send", to: "build" });
        expect(outcome?.reason).toContain("0.002-minute limit");
        expect(outcome?.reason).toContain("begun");
      }),
    ));
});

describe("one Electron app at a time", () => {
  it("scenario: a live holder's lock is waited on, not failed, and taken when it goes; the scope gives it back", () =>
    ran(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const lock = `${yield* temp}/electron.lock`;
        // This test's own pid: a live process that holds the lock.
        yield* fs.writeFileString(lock, String(process.pid));
        const taken = yield* Ref.make(false);
        const fiber = yield* Effect.forkChild(
          Effect.scoped(
            Effect.gen(function* () {
              yield* electronLock(lock, "10 millis");
              yield* Ref.set(taken, true);
              return yield* fs.readFileString(lock);
            }),
          ),
        );
        yield* Effect.sleep("100 millis");
        expect(yield* Ref.get(taken)).toBe(false);
        yield* fs.remove(lock);
        const held = yield* Fiber.join(fiber);
        expect(held).toBe(String(process.pid));
        expect(yield* Ref.get(taken)).toBe(true);
        expect(yield* fs.exists(lock)).toBe(false);
      }),
    ));

  it("scenario: a dead holder's lock is taken over at once", () =>
    ran(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const lock = `${yield* temp}/electron.lock`;
        // Above any pid macOS hands out (99998), so no process holds it.
        yield* fs.writeFileString(lock, "2000000000");
        const held = yield* Effect.scoped(
          electronLock(lock, "1 hour").pipe(Effect.andThen(fs.readFileString(lock)), Effect.timeoutOption("5 seconds")),
        );
        expect(held).toEqual(Option.some(String(process.pid)));
      }),
    ));
});

describe("the lane's state file", () => {
  it("scenario: a host entry joins drive's steps, keeps their fields, and moves the head only on done", () =>
    ran(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const boxes = yield* temp;
        yield* fs.makeDirectory(`${boxes}/state`);
        const state = `${boxes}/state/lane.json`;
        const before = { lane: "lane", ticket: "7", head: sha, steps: [{ step: "build", outcome: "done", head: sha }] };
        yield* fs.writeFileString(state, JSON.stringify(before));
        const at = { boxes, lane: "lane", ticket: "7", round: 3, head: sha };
        const sent = { _tag: "send", to: "build", reason: "red" } as const;
        yield* recordInLane(at, { outcome: sent, head: sha, log: "x.log" }, "t1");
        const done = { _tag: "done", reason: "ok" } as const;
        yield* recordInLane(at, { outcome: done, head: "b".repeat(40), log: "y.log" }, "t2");
        const after = JSON.parse(yield* fs.readFileString(state));
        expect(after.ticket).toBe("7");
        expect(after.head).toBe("b".repeat(40));
        expect(after.steps.map((e: { step: string; outcome: string }) => `${e.step} ${e.outcome}`)).toEqual([
          "build done",
          "host send:build:host_failed",
          "host done",
        ]);
        expect(after.steps[1]).toMatchObject({ head: sha, report: "x.log", box: "lane-host3", ended: "t1" });
        // A review is told the last host entry, read back from the file as written.
        expect(lastHost(after.steps)).toBe(`done at ${"b".repeat(40)}: ok`);
        expect(lastHost(before.steps)).toBeNull();
      }),
    ));
});
