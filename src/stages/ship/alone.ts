import { run } from "@demlik/tea/effect";
import { Effect, Layer } from "effect";
import type { CodeHost, CodeHostWrites } from "../../services.ts";
import { shipReadInterpret, shipSubscribe, shipWriteInterpret } from "./handlers.ts";
import { type Look, look } from "./look.ts";
import { ship } from "./machine.ts";
import type { ShipOutcome } from "./outcome.ts";

// The ship machine alone on one pull request, in one of two modes.
//
//   read   the default. Read, gate, say what it would send. It is given the
//          read service only, so it cannot write.
//   write  asked for by name. The machine runs to its end with the handlers
//          that write and the two Listens.
//
// The write side is made by a call (`parts.writes`), and that call is only
// reached in write mode.

/** What a run was asked for, from the command line. */
export interface Plan {
  readonly pr: string;
  /** The accounts the repo treats as its own. */
  readonly own: readonly string[];
  /** The accounts whose review verdicts count. */
  readonly reviewers: readonly string[];
  readonly write: boolean;
}

/** `<pull request url> --own a,b [--reviewers c,d] [--write]`, read. `null`: not that. Writing is off unless `--write` is there. */
export function planOf(argv: readonly string[]): Plan | null {
  const [pr, ...flags] = argv;
  const accounts = (flag: string): readonly string[] => {
    const at = flags.indexOf(flag);
    return at === -1 ? [] : (flags[at + 1] ?? "").split(",").filter((login) => login !== "" && !login.startsWith("--"));
  };
  const own = accounts("--own");
  const reviewers = accounts("--reviewers");
  if (pr === undefined || !/github\.com\/[^/\s]+\/[^/\s]+\/pull\/\d+/.test(pr) || own.length === 0) return null;
  return { pr, own, reviewers: reviewers.length === 0 ? own : reviewers, write: flags.includes("--write") };
}

/** The one line a run opens with, so nobody has to guess which mode it is in. */
export const modeLine = (plan: Plan): string =>
  plan.write
    ? `mode: WRITE. This run may put ${plan.pr} in the merge queue and start its red checks again.`
    : `mode: read only. Nothing on ${plan.pr} will be changed.`;

/** The services a run is made from. Each is a call, so the write side exists only when it is asked for. */
export interface Parts {
  readonly reads: () => Layer.Layer<CodeHost>;
  readonly writes: () => Layer.Layer<CodeHostWrites>;
}

export type Alone = { readonly mode: "read"; readonly found: Look } | { readonly mode: "write"; readonly pr: string; readonly outcome: ShipOutcome };

/** The machine to its end, with the handlers that write and the two Listens. */
const toTheEnd = (pr: string, machine: typeof ship) =>
  Effect.gen(function* () {
    const handle = yield* run(machine, {
      ctx: undefined,
      // A run alone holds no working copy, so the tidy-up has nothing of its own to remove.
      interpret: { ...shipReadInterpret, ...shipWriteInterpret() },
      subscribe: shipSubscribe,
      terminal: (s) => s.phase === "over",
    });
    const runtime = yield* handle.ready;
    yield* runtime.dispatch({ type: "start", pr });
    const end = yield* runtime.done();
    if (end.phase !== "over") return yield* Effect.die(`the run stopped in ${end.phase}`);
    return end.outcome;
  }).pipe(Effect.scoped);

/** Run a plan. `machine`: a ship machine with other limits, for a test. */
export const alone = (plan: Plan, parts: Parts, machine = ship) =>
  plan.write
    ? toTheEnd(plan.pr, machine).pipe(
        Effect.map((outcome): Alone => ({ mode: "write", pr: plan.pr, outcome })),
        Effect.provide(Layer.mergeAll(parts.reads(), parts.writes())),
      )
    : look(plan.pr).pipe(
        Effect.map((found): Alone => ({ mode: "read", found })),
        Effect.provide(parts.reads()),
      );
