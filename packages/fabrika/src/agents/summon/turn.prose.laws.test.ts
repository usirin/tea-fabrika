import { Effect, Layer, Stream } from "effect";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { HostJobs, openJobs } from "../../host/host-jobs.ts";
import { ear } from "../../program/ear.ts";
import { listed } from "../../program/listed.ts";
import { start, tell } from "../../program/program.ts";
import { memoryStorage } from "../../program/storage.ts";
import { Programs, programList } from "../../shell/programs.ts";
import { type Printed, type Ready, tsh } from "../../shell/shell.ts";
import { SMALL } from "../../shell/small.ts";
import { SummonManager, type Summoned } from "../../shell/summon.ts";
import { turnProgram } from "./turn.ts";

// Law S-1 of the summon tryout (ticket 237, PR 1), today's version, through tsh: for any prose,
// the value the `turn` program hands the agent is the line from the character after the mention
// and its one space, exactly. shell/said.laws.test.ts holds it on the parse; this one holds it on
// what reaches `SummonManager.turn`, so neither shell words nor a quoted tell line can cut it on
// the way.
//
//   tsh$ @scout why does post print #7 twice? don't guess
//   turn("scout", "why does post print #7 twice? don't guess", null)
//
// The planted bug it must catch: the said line cut by `words`, which drops `#7 twice?` and opens
// a quote at `don't`.

/** Seed 119120: the shared one (AGENTS.md). Each run starts one tsh in memory. */
const OPTS = { numRuns: 60, seed: 119120 };

const PERSON = "user:owner";

const SCOUT: Summoned = {
  name: "scout",
  agent: "fake",
  model: { typed: null, resolved: "fake-small" },
  effort: { typed: null, set: null },
  folder: "/repo",
  since: 0,
  by: PERSON,
  state: "idle",
  cost: null,
};

/** A manager in memory that keeps the prompts it is handed and answers each turn at once. */
const recording = () => {
  const prompts: string[] = [];
  const service: typeof SummonManager.Service = {
    summon: () => Effect.succeed(SCOUT),
    dismiss: () => Effect.succeed({ cut: null }),
    list: Effect.succeed([SCOUT]),
    turn: (_name, prompt) => {
      prompts.push(prompt);
      const n = prompts.length;
      return Stream.fromIterable([
        { _tag: "told", turn: n } as const,
        { _tag: "said", text: `reply ${n}` } as const,
        { _tag: "result", stop: "end_turn", ms: 1, cost: null } as const,
      ]);
    },
    cancel: () => Effect.void,
    answer: () => Effect.void,
  };
  return { prompts, service };
};

/** Type one line into a fresh tsh, and hand back its status and the prompts the manager got. */
const typed = (line: string) =>
  Effect.gen(function* () {
    const m = recording();
    const storage = memoryStorage();
    const jobs = yield* openJobs(storage);
    const printed = ear<Printed>();
    const ready = ear<Ready>();
    const list = programList([...SMALL, listed(turnProgram, Layer.succeed(SummonManager, m.service))]);
    const started = yield* start(
      tsh,
      { show: "short" },
      { printed: printed.hear, ready: ready.hear },
      { id: "tsh:said-law", storage },
    ).pipe(
      Effect.provideService(HostJobs, { ...jobs, owner: "t1", by: PERSON }),
      Effect.provideService(Programs, list),
      Effect.provideService(SummonManager, m.service),
    );

    if (started.kind !== "running") {
      return yield* Effect.die("tsh did not start");
    }

    yield* tell(started.run, "line", line);
    const [first] = yield* ready.upTo(1);
    return { status: first?.status, prompts: m.prompts, printed: printed.values };
  }).pipe(Effect.scoped);

const SHELL_BITS = ["&", "|", ";", "#", "'", '"', "\\", "$(", ")", "&&", "||", "#7", "don't"];
const PLAIN = ["a", "why", "twice?", "7", "post", "x.txt", " ", "  "];

const prose = fc
  .array(fc.constantFrom(...SHELL_BITS, ...PLAIN), { minLength: 1, maxLength: 12 })
  .map((parts) => parts.join(""))
  .filter((p) => p.trim() !== "" && !p.startsWith("@"));

describe("S-1: the agent is handed the prose exactly as typed", () => {
  it("holds for any prose with & | ; # ' \" \\ $(", async () => {
    await fc.assert(
      fc.asyncProperty(prose, (text) =>
        Effect.runPromise(
          Effect.gen(function* () {
            const seen = yield* typed(`@scout ${text}`);
            expect(seen.status).toBe(0);
            expect(seen.prompts).toEqual([text]);
          }),
        ),
      ),
      OPTS,
    );
  }, 120_000);

  it("keeps #7 twice? and don't, on the line the plan traces", async () => {
    const seen = await Effect.runPromise(typed("@scout why does post print #7 twice? don't guess; check a | b & c"));
    expect(seen.status).toBe(0);
    expect(seen.prompts).toEqual(["why does post print #7 twice? don't guess; check a | b & c"]);
  });
});
