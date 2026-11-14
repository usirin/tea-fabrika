// Experiment 285, next/. `Control` as a small Effect Worker of its own, the other form decision
// 0041 asks the spike to run. It answers with the props it was called with.
import * as Cloudflare from "@alchemy.run/cloudflare";
import { Effect } from "effect";
import { HttpServerResponse } from "effect/http";

export class ControlOwn extends Cloudflare.Worker<ControlOwn, Record<never, never>>()("Control285") {}

export default ControlOwn.make(
  { main: import.meta.url, dev: { host: "127.0.0.1" }, compatibility: { date: "2026-10-12" } },
  Effect.gen(function* () {
    const ctx = yield* Cloudflare.WorkerExecutionContext;
    return {
      fetch: Effect.gen(function* () {
        const props = yield* ctx.props;
        return yield* HttpServerResponse.json({ worker: "control", token: typeof props.token === "string" });
      }),
    };
  }),
);
