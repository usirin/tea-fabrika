import { Effect } from "effect";
import { CodeHost } from "../../services.ts";
import type { readShipFacts } from "./machine.ts";

// The ship machine's handlers. Only the read is here: the Gather asks the
// `CodeHost` service. `ship_enqueue` and `ship_finish` write, and nothing
// answers them yet.

export const shipReadInterpret = {
  ship_facts: (cmd: ReturnType<typeof readShipFacts>) =>
    Effect.gen(function* () {
      return yield* (yield* CodeHost).prFacts(cmd.pr);
    }),
};
