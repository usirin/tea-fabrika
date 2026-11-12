// Runs: before a box folder goes, its `runs/` (raw samples, never in git) moves into MAIN's
// `runs/<box>/`. This file is the contract only (0095): `RunsProcess.layer` runs keepruns.sh,
// `RunsTest.layer` answers from memory. Today's lead tooling, run on our own laptop.
import { Context } from "effect";
import type { Effect } from "effect";

/** What the move said, as the person reads it, and whether the folder may now go. */
export type Kept = { readonly said: string; readonly kept: boolean };

export class Runs extends Context.Service<
  Runs,
  {
    /** Move `folder`'s runs/ into MAIN. `kept: false` means the folder must stay. Never fails. */
    readonly keep: (folder: string) => Effect.Effect<Kept>;
  }
>()("lead/box/Runs") {}
