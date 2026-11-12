// box rm's laws, on memory (every generated plan) and on real git and keepruns.sh (a small sample
// and every vector), so the memory world stays honest. The laws live in box/BoxTest.ts.
import { NodeServices } from "@effect/platform-node";
import { Effect } from "effect";
import * as BoxTest from "./box/BoxTest.ts";
import * as BoxTestGit from "./box/BoxTestGit.ts";

const run: BoxTest.Run = (law) =>
  // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: Vitest awaits the Promise a test hands back
  Effect.runPromise(law.pipe(Effect.scoped, Effect.provide(NodeServices.layer)));

BoxTest.rm.suite("memory", BoxTest.memory, run, { numRuns: 300, seed: 119120 });
BoxTest.rm.suite("git", BoxTestGit.world, run, { numRuns: 12, seed: 119120 });
