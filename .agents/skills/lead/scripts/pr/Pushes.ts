// Pushes: how a commit leaves the laptop (0134). The leak grep reads it first and fails closed, then
// the push sends it, never forced. This file is the contract only (0095): `PushesProcess.layer`
// runs leakgrep.sh and botpush.mjs, `PushesTest.layer` answers from memory. Today's lead tooling.
import { Context, Schema } from "effect";
import type { Effect } from "effect";

/** The leak grep refused the commits, or could not run; nothing was pushed. */
export class LeakGrepRefused extends Schema.TaggedError<LeakGrepRefused>()("LeakGrepRefused", {
  reason: Schema.String,
}) {}

/** The push did not happen: refused by GitHub, no step notes, no key, or no network. */
export class PushRefused extends Schema.TaggedError<PushRefused>()("PushRefused", { reason: Schema.String }) {}

export class Pushes extends Context.Service<
  Pushes,
  {
    /** leakgrep.sh on each commit of `origin/main..head` in the checkout `dir`. */
    readonly leakGrep: (dir: string, head: string) => Effect.Effect<void, LeakGrepRefused>;
    /** Pushes `head` to `branch` on origin, with the step notes, from the checkout `dir`. */
    readonly push: (dir: string, branch: string, head: string) => Effect.Effect<void, PushRefused>;
  }
>()("lead/pr/Pushes") {}
