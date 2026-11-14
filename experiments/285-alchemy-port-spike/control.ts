// Experiment 285, next/. Question 2, the other form: `Control` as its own Effect Worker beside the
// brain. It asks what the local runtime gives a second Worker: its own process, its own public
// address, and which Worker a private socket with props lands on.
import * as Alchemy from "alchemy";
import { Deferred, Effect } from "effect";
import { call, providers, run, save, start, starts } from "./harness.ts";
import * as own from "./own.ts";
import * as probe from "./probe.ts";

const TOKEN = "t-285-secret";

await run(
  Effect.gen(function* () {
    const ports = yield* Deferred.make<Record<string, number>>();
    const stack = Alchemy.Stack(
      "spike285",
      {
        providers: providers([{ name: "spike-control", props: { token: TOKEN } }], ports),
        state: Alchemy.localState(),
      },
      Effect.gen(function* () {
        const brain = yield* probe.Probe;
        const control = yield* own.ControlOwn;
        return { brain: brain.url, control: control.url };
      }).pipe(Effect.provide(probe.default), Effect.provide(own.default)),
    );
    const out = (yield* start(stack)) as { brain: string; control: string };
    yield* Deferred.await(ports);
    const brain = yield* call(`${out.brain.replace(/\/$/, "")}/props`);
    // The second Worker's own public address, with no props and no bearer.
    const open = yield* call(out.control);
    const sockets = yield* Effect.forEach(
      starts,
      (listening) =>
        call(`http://127.0.0.1:${listening["spike-control"]}/props`, {
          headers: { authorization: `Bearer ${TOKEN}` },
        }).pipe(Effect.map((reply) => ({ status: reply.status, body: reply.text }))),
      { concurrency: 1 },
    );
    yield* save("control", {
      urls: out,
      workerdStarts: starts.length,
      brainPublic: { status: brain.status, body: brain.text },
      controlPublic: { status: open.status, body: open.text },
      privateSockets: sockets,
    });
  }),
);
