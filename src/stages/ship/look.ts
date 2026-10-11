import { applyCell } from "@demlik/tea";
import { Effect } from "effect";
import type { CodeHost } from "../../services.ts";
import type { ShipFacts } from "./facts.ts";
import { shipReadInterpret } from "./handlers.ts";
import { type enqueue, readShipFacts, type Ship, type ShipCmd, ship } from "./machine.ts";
import type { ShipOutcome } from "./outcome.ts";

// The ship machine on one pull request, as far as reading goes. It starts the
// real machine, answers its one read from the `CodeHost`, and stops at the
// first Cmd that would write. That Cmd is handed back, never sent. There is
// no way to make this write: it holds no handler that does.

/** What a look found. */
export interface Look {
  readonly pr: string;
  /** `null`: the read failed. */
  readonly facts: ShipFacts | null;
  /** The machine's answer, when the run ends at the gate or at a failed read. `null`: the gate said go. */
  readonly outcome: ShipOutcome | null;
  /** The Cmd the machine sends next when the gate says go. It was not sent. */
  readonly wouldSend: ReturnType<typeof enqueue> | null;
}

type AnyMsg = { readonly type: string; readonly [field: string]: unknown };
const step = (s: Ship, msg: AnyMsg) => applyCell<Ship, AnyMsg, ShipCmd>(ship, s, msg);

/** Read one pull request and say what the machine does with it, up to its first write. */
export const look = (pr: string): Effect.Effect<Look, never, CodeHost> =>
  Effect.gen(function* () {
    const [reading, [read]] = step({ phase: "idle" }, { type: "start", pr });
    if (read?.type !== "ship_facts") throw new Error("the ship machine did not start with its read");
    const answer = yield* shipReadInterpret.ship_facts(read).pipe(
      Effect.match({
        onSuccess: (value): AnyMsg & { readonly value?: ShipFacts } => ({ type: readShipFacts.okType, cmd: read, value }),
        onFailure: (error): AnyMsg & { readonly value?: ShipFacts } => ({ type: readShipFacts.errType, cmd: read, error }),
      }),
    );
    const [after, cmds] = step(reading, answer);
    const [next] = cmds;
    return {
      pr,
      facts: answer.value ?? null,
      outcome: after.phase === "over" ? after.outcome : null,
      wouldSend: next?.type === "ship_enqueue" ? next : null,
    };
  });
