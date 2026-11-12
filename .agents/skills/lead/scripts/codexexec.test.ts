// The codex-exec rows (./codexexec.ts) through `runTurn` (./agents.ts), on a fake `codex` found
// on the PATH of a temp folder the scope gives back. The fake records each call's arguments and
// plays what the test planned for that call: its JSON lines, its last message, its exit code.
//
// Edge cases, listed before the code (decision 0040), each with a law below:
//   1. a failure that names capacity is tried again, and never more than 6 times in all;
//   2. a failure that names no capacity is tried once;
//   3. a non-empty last message holding a valid answer is done, in one call;
//   4. a non-empty last message with no valid answer asks once more, on the same thread, and
//      exactly once: an answer then is taken, none then fails the turn `no_answer`;
//   5. an empty last message never asks for the answer: the turn failed;
//   6. a second turn under the same session key resumes the thread the first opened;
//   7. no command line holds `--ignore-user-config`, and every one says approvals `never`;
//   8. a prompt that starts with `-` is never passed where a flag would be read;
//   9. a read row runs Codex's read-only sandbox, a write row workspace-write;
//  10. the tokens of `turn.completed` reach `spent`; over a resumed thread they are its running
//      total, so the larger count wins and is never added twice, while tool calls add up;
//  11. no try starts that the turn's minutes could not wait for.
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
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "./agents.ts?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "./codexexec.ts?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "./boxnode.ts?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "./drive.ts?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "./runid.ts?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "./pgrep.ts?raw";
import "./catchup.sh?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "./freshmain.ts?raw";
import "./box.sh?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "./boxfiles.ts?raw";
import "./keepruns.sh?raw";
import "./leakgrep.sh?raw";
import "./fieldrow.py?raw";
import "./runplan.sh?raw";
import "./env.sh?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "./gc.ts?raw";
import "./redact.sh?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "./botpush.mjs?raw";
import "./clauderow.py?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "./lane.ts?raw";
import "../../plan/scripts/plancheck.sh?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "./sizecap.ts?raw";
import "../../step-commit/scripts/exam.py?raw";
import "../../step-commit/scripts/stepcommit.sh?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "./gcloop.ts?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "./flow/Beat.ts?raw";
import { NodeServices } from "@effect/platform-node";
import { Agent } from "@kampus/fabrika-old";
import { Effect, FileSystem, type Scope } from "effect";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { Answer, CapacityRetry, runTurn, type TurnAsk, type Turned } from "./agents.ts";
import { CAPACITY, codexExecAdapter, type ExecAsk, execArgs } from "./codexexec.ts";

const options = { seed: 119120, numRuns: 12 };

const ran = <A, E>(law: Effect.Effect<A, E, NodeServices.NodeServices | Scope.Scope>) =>
  // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: Vitest awaits the Promise a test hands back
  Effect.runPromise(law.pipe(Effect.scoped, Effect.provide(NodeServices.layer)));

/** The fake: counts its calls, keeps each one's arguments (NUL apart) and plays `out-<n>`, `last-<n>`, `code-<n>`. */
const FAKE = `#!/bin/sh
dir="$FAKE_DIR"
n=$(( $(cat "$dir/count" 2>/dev/null || echo 0) + 1 ))
echo "$n" > "$dir/count"
printf '%s\\0' "$@" > "$dir/argv-$n"
last=""; prev=""
for a in "$@"; do [ "$prev" = "-o" ] && last="$a"; prev="$a"; done
k=$n; [ -f "$dir/out-$k" ] || k=default
[ -f "$dir/out-$k" ] && cat "$dir/out-$k"
[ -f "$dir/last-$k" ] && cp "$dir/last-$k" "$last"
exit "$(cat "$dir/code-$k" 2>/dev/null || echo 0)"
`;

/** What one call of the fake plays. */
interface Play {
  readonly lines: ReadonlyArray<object>;
  readonly last?: string;
  readonly code?: number;
}

const ANSWER = { verb: "done", to: null, reason: "three laws green", laws: null };
const usage = { input_tokens: 1000, cached_input_tokens: 400, output_tokens: 50 };

const answered = (report: string, thread = "thread-1"): Play => ({
  lines: [
    { type: "thread.started", thread_id: thread },
    { type: "item.started", item: { id: "c1", type: "command_execution", command: "pnpm test" } },
    {
      type: "item.completed",
      item: { id: "c1", type: "command_execution", command: "pnpm test", status: "completed" },
    },
    { type: "item.completed", item: { id: "m1", type: "agent_message", text: report } },
    { type: "turn.completed", usage },
  ],
  last: report,
});

const failing = (message: string): Play => ({
  lines: [
    { type: "error", message },
    { type: "turn.failed", error: { message } },
  ],
  code: 1,
});

/** A world: the fake on PATH, its plays, the agents on the codex-exec rows, and what each call was handed. */
const world = (plays: ReadonlyArray<Play>) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const dir = yield* fs.makeTempDirectoryScoped({ prefix: "codexexec-" });
    yield* fs.writeFileString(`${dir}/codex`, FAKE);
    yield* fs.chmod(`${dir}/codex`, 0o755);
    yield* fs.makeDirectory(`${dir}/work`);

    for (const [i, play] of plays.entries()) {
      const n = i + 1;
      yield* fs.writeFileString(`${dir}/out-${n}`, play.lines.map((l) => `${JSON.stringify(l)}\n`).join(""));
      yield* play.last === undefined ? Effect.void : fs.writeFileString(`${dir}/last-${n}`, play.last);
      yield* fs.writeFileString(`${dir}/code-${n}`, String(play.code ?? 0));
    }

    const env = { ...process.env, PATH: `${dir}:${process.env.PATH ?? ""}`, FAKE_DIR: dir };
    const agents = Agent.makeAgents({
      adapters: {
        "codex-exec": yield* codexExecAdapter({ access: "write", env }),
        "codex-exec-read": yield* codexExecAdapter({ access: "read", env }),
      },
      sessions: yield* Agent.fileSessions(`${dir}/sessions`),
      reaper: Agent.noReaper,
    });
    const calls = Effect.gen(function* () {
      const count = Number((yield* fs.readFileString(`${dir}/count`).pipe(Effect.orElseSucceed(() => "0"))).trim());
      const argv: string[][] = [];

      for (let n = 1; n <= count; n++) {
        argv.push((yield* fs.readFileString(`${dir}/argv-${n}`)).split("\0").slice(0, -1));
      }

      return argv;
    });
    const ask = (over: Partial<TurnAsk<Answer>> = {}): TurnAsk<Answer> => ({
      provider: "codex-exec",
      session: "lane-build1",
      folder: `${dir}/work`,
      prompt: "Add a function and its laws.",
      system: "You are the build step.",
      answer: Answer,
      model: "gpt-6-astra",
      effort: "medium",
      minutes: 5,
      events: `${dir}/events.jsonl`,
      report: `${dir}/report.md`,
      ...over,
    });
    const turn = (over: Partial<TurnAsk<Answer>> = {}, retry = { tries: 6, waitSeconds: 0 }) =>
      runTurn(agents, ask(over)).pipe(Effect.provideService(CapacityRetry, retry));
    const read = (path: string) => fs.readFileString(path).pipe(Effect.orElseSucceed(() => ""));
    return { dir, calls, turn, read };
  });

const answerIn = (t: Turned<Answer>) => (t._tag === "ended" ? t.answer : null);

/** A message that names no capacity word. */
const plainMessage = fc.string({ minLength: 1, maxLength: 40 }).filter((m) => !CAPACITY.test(m) && m.trim() !== "");

describe("codex-exec: capacity", () => {
  it("property: a capacity failure is tried again until a try answers, and never more than 6 tries in all", () =>
    fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 0, max: 8 }),
        fc.constantFrom("Selected model is at capacity", "rate limit reached", "503 Service Unavailable", "overloaded"),
        (fails, words) =>
          ran(
            Effect.gen(function* () {
              const plays = [...Array.from({ length: fails }, () => failing(words)), answered(JSON.stringify(ANSWER))];
              const w = yield* world(plays);
              const t = yield* w.turn();
              const calls = yield* w.calls;
              expect(calls).toHaveLength(Math.min(fails + 1, 6));
              expect(t._tag).toBe(fails < 6 ? "ended" : "failed");
            }),
          ),
      ),
      options,
    ));

  it("property: a failure that names no capacity word is tried once", () =>
    fc.assert(
      fc.asyncProperty(plainMessage, (message) =>
        ran(
          Effect.gen(function* () {
            const w = yield* world([failing(message), answered(JSON.stringify(ANSWER))]);
            const t = yield* w.turn();
            expect(yield* w.calls).toHaveLength(1);
            expect(t).toMatchObject({ _tag: "failed", reason: "broke" });
          }),
        ),
      ),
      options,
    ));

  it("scenario: no try starts that the turn's minutes cannot wait for, so a 60 second wait in a 1 minute turn tries once", () =>
    ran(
      Effect.gen(function* () {
        const w = yield* world([failing("at capacity"), answered(JSON.stringify(ANSWER))]);
        const t = yield* w.turn({ minutes: 1 }, { tries: 6, waitSeconds: 60 });
        expect(yield* w.calls).toHaveLength(1);
        expect(t._tag).toBe("failed");
      }),
    ));
});

describe("codex-exec: the typed answer", () => {
  it("property: a last message that holds a valid answer after the report is done in one call, with its tokens", () =>
    fc.assert(
      fc.asyncProperty(fc.string({ maxLength: 200 }), (prose) =>
        ran(
          Effect.gen(function* () {
            const report = `${prose}\n\n${JSON.stringify(ANSWER)}`;
            const w = yield* world([answered(report)]);
            const t = yield* w.turn();
            expect(yield* w.calls).toHaveLength(1);
            expect(answerIn(t)).toEqual(ANSWER);
            expect(t.spent).toMatchObject({ input: 1000, cached: 400, output: 50, counted: "turn", tools: 1 });
            expect(yield* w.read(`${w.dir}/report.md`)).toBe(report);
          }),
        ),
      ),
      options,
    ));

  it("scenario: a report with no answer asks once more on the same thread, and takes the answer it gives", () =>
    ran(
      Effect.gen(function* () {
        // The resumed turn says the thread's running total, as Codex 0.167.0 did for real.
        const total = { input_tokens: 1300, cached_input_tokens: 500, output_tokens: 60 };
        const again = answered(JSON.stringify(ANSWER));
        const resumed: Play = {
          ...again,
          lines: again.lines.map((l) => ("usage" in l ? { type: "turn.completed", usage: total } : l)),
        };
        const w = yield* world([answered("All three laws pass."), resumed]);
        const t = yield* w.turn();
        const calls = yield* w.calls;
        expect(calls).toHaveLength(2);
        expect(calls[0]).not.toContain("resume");
        expect(calls[1]?.slice(calls[1].indexOf("resume"), calls[1].indexOf("resume") + 2)).toEqual([
          "resume",
          "thread-1",
        ]);
        expect(answerIn(t)).toEqual(ANSWER);
        expect(t.spent).toMatchObject({ input: 1300, cached: 500, output: 60, tools: 2 });
        const report = yield* w.read(`${w.dir}/report.md`);
        expect(report.startsWith("All three laws pass.")).toBe(true);
      }),
    ));

  it("property: a report with no answer, then an answer turn with none, asks exactly once and fails no_answer", () =>
    fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 80 }).filter((s) => !s.includes("{") && s.trim() !== ""),
        (words) =>
          ran(
            Effect.gen(function* () {
              const w = yield* world([answered(words), answered(words), answered(JSON.stringify(ANSWER))]);
              const t = yield* w.turn();
              expect(yield* w.calls).toHaveLength(2);
              expect(t).toMatchObject({ _tag: "failed", reason: "no_answer" });
            }),
          ),
      ),
      options,
    ));

  it("scenario: an empty last message never asks for the answer: the turn failed, in one call", () =>
    ran(
      Effect.gen(function* () {
        const w = yield* world([
          {
            lines: [
              { type: "thread.started", thread_id: "t" },
              { type: "turn.completed", usage },
            ],
          },
          answered(JSON.stringify(ANSWER)),
        ]);
        const t = yield* w.turn();
        expect(yield* w.calls).toHaveLength(1);
        expect(t).toMatchObject({ _tag: "failed", reason: "broke" });
      }),
    ));
});

describe("codex-exec: the session", () => {
  it("scenario: a second turn under the same session key resumes the thread the first opened", () =>
    ran(
      Effect.gen(function* () {
        const w = yield* world([answered(JSON.stringify(ANSWER), "019a-thread"), answered(JSON.stringify(ANSWER))]);
        yield* w.turn();
        yield* w.turn({ prompt: "Now fix the review's notes." });
        const [first = [], second = []] = yield* w.calls;
        expect(first).not.toContain("resume");
        expect(second[second.indexOf("resume") + 1]).toBe("019a-thread");
        expect(second.at(-1)).toContain("Now fix the review's notes.");
      }),
    ));

  it("scenario: a turn under another session key starts fresh", () =>
    ran(
      Effect.gen(function* () {
        const w = yield* world([answered(JSON.stringify(ANSWER)), answered(JSON.stringify(ANSWER))]);
        yield* w.turn();
        yield* w.turn({ session: "lane-review1" });
        expect((yield* w.calls).every((argv) => !argv.includes("resume"))).toBe(true);
      }),
    ));

  it("scenario: a read row's call runs Codex's read-only sandbox, a write row's workspace-write", () =>
    ran(
      Effect.gen(function* () {
        const w = yield* world([answered(JSON.stringify(ANSWER)), answered(JSON.stringify(ANSWER))]);
        yield* w.turn();
        yield* w.turn({ provider: "codex-exec-read", session: "lane-review1" });
        const [write = [], read = []] = yield* w.calls;
        expect(write).toContain('sandbox_mode="workspace-write"');
        expect(read).toContain('sandbox_mode="read-only"');
      }),
    ));
});

describe("codex-exec: the command line", () => {
  const execAsk: fc.Arbitrary<ExecAsk> = fc.record({
    access: fc.constantFrom("write" as const, "read" as const),
    folder: fc.string({ minLength: 1 }).map((s) => `/w/${s}`),
    prompt: fc.string(),
    resume: fc.option(fc.uuid(), { nil: null }),
    model: fc.option(fc.constantFrom("gpt-6-astra", "gpt-6.1-sol"), { nil: null }),
    effort: fc.option(fc.constantFrom("low", "medium", "high"), { nil: null }),
    system: fc.option(fc.string(), { nil: null }),
    last: fc.constant("/tmp/last.md"),
  });

  it("property: no command line holds --ignore-user-config, and every one says approvals never", () => {
    fc.assert(
      fc.property(execAsk, (a) => {
        const args = execArgs(a);
        expect(args).not.toContain("--ignore-user-config");
        expect(args).toContain('approval_policy="never"');
        expect(args.slice(0, 4)).toEqual(["exec", "--json", "-o", a.last]);
      }),
      { seed: 119120, numRuns: 300 },
    );
  });

  it("property: the prompt is the last argument and never starts with -, so it is never read as a flag", () => {
    fc.assert(
      fc.property(execAsk, (a) => {
        const last = execArgs(a).at(-1) ?? "";
        expect(last.startsWith("-")).toBe(false);
        expect(last.trimStart()).toBe(a.prompt.trimStart());
      }),
      { seed: 119120, numRuns: 300 },
    );
  });

  it("property: resume comes after every option, with the thread right after it", () => {
    fc.assert(
      fc.property(execAsk, (a) => {
        const args = execArgs(a);
        // The prompt, last, may itself say "resume"; only an option word before it counts.
        const at = args.slice(0, -1).indexOf("resume");
        expect(at === -1).toBe(a.resume === null);

        if (a.resume !== null) {
          expect(args.slice(at + 1)).toEqual([a.resume, args.at(-1)]);
        }
      }),
      { seed: 119120, numRuns: 300 },
    );
  });
});
