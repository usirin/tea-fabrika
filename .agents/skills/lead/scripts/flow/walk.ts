// walk.ts: walk one flow to its end with the `Runners` service, saving its Model to a state file
// (0064). Today's lead tooling. The command line around it is the flow runner beside this file; a
// test calls `runFlow` here with fake runners and a temp state file.
//
// The walk is the flow machine on tea's Effect engine. tea's own file store saves its Model before
// each step starts and once it ends, and is fenced, so a second process on one state file is
// refused. A first walk refuses a state file that exists; a resume goes on from one, and refuses a
// flow that changed since it was saved.

import { refuse } from "@demlik/tea";
import { run } from "@demlik/tea/effect";
import { fileStore } from "@demlik/tea/node";
import { Clock, Effect, FileSystem, Option, Runtime, Schema } from "effect";
import * as Flow from "./Flow.ts";
import * as FlowMachine from "./machine.ts";
import * as Runners from "./Runners.ts";

/** The command was used wrong, or its files do not fit: exit 2. */
export class Usage extends Schema.TaggedError<Usage>()("Usage", { reason: Schema.String }) {
  readonly [Runtime.errorExitCode] = 2;
}

/** How a flow that stopped ended, as the last line says it. */
export type End = { readonly outcome: "done" | "ask" | "stuck"; readonly reason: string; readonly exit: 0 | 20 | 30 };

export const ending = (m: FlowMachine.Model): End => {
  if (m._tag === "done") {
    return { outcome: "done", reason: `${m.flow.steps.length} steps ended done or skip`, exit: 0 };
  }

  if (m._tag === "parked") {
    return { outcome: "ask", reason: m.reason, exit: 20 };
  }

  if (m._tag === "stuck") {
    return { outcome: "stuck", reason: m.reason, exit: 30 };
  }

  return { outcome: "stuck", reason: `the flow stopped while ${m.flow.steps[m.position]?.name} ran`, exit: 30 };
};

/** The saved Model, read back by tea's store: a file that is no Model is refused, never booted. */
const parse = (raw: unknown) =>
  raw === null || raw === undefined
    ? null
    : Option.getOrElse(Schema.decodeUnknownOption(FlowMachine.Model)(raw), () =>
        refuse("the state file holds no flow Model"),
      );

/** A runner's failure as tea's error channel takes it: plain data with its tag. */
const Failed = Schema.TaggedStruct("StepFailed", { reason: Schema.String });

export type Options = { readonly state: string; readonly resume: boolean; readonly lead: boolean };

/** Walk `flow` with the `Runners` service, saving to `options.state`; its Model when it stops. */
export const runFlow = Effect.fn("flow.run")(function* (flow: Flow.Flow, options: Options) {
  const runners = yield* Runners.Runners;
  const fs = yield* FileSystem.FileSystem;
  const missing = flow.steps.filter((s) => !runners.names.has(s.name)).map((s) => s.name);

  if (missing.length > 0) {
    return yield* new Usage({ reason: `no runner for steps ${missing.join(", ")}` });
  }

  const saved = yield* fs.exists(options.state).pipe(Effect.orElseSucceed(() => false));

  if (saved && !options.resume) {
    return yield* new Usage({ reason: `${options.state} exists; pass --resume to go on from it` });
  }

  if (!saved && options.resume) {
    return yield* new Usage({ reason: `${options.state} does not exist; there is nothing to resume` });
  }

  if (saved) {
    const text = yield* fs.readFileString(options.state).pipe(Effect.orElseSucceed(() => ""));
    const model = Schema.decodeUnknownOption(Schema.fromJsonString(FlowMachine.Model))(text);

    if (Option.isNone(model)) {
      return yield* new Usage({ reason: `${options.state} holds no flow Model` });
    }

    if (!Flow.equals(model.value.flow, flow)) {
      return yield* new Usage({ reason: `the flow file changed since ${options.state} was saved; start a new flow` });
    }
  }

  const at = yield* Clock.currentTimeMillis;
  const handle = yield* run(FlowMachine.make({ lead: options.lead }), {
    ctx: { flow, at },
    store: fileStore(options.state, parse, { fenced: true }),
    onError: (error, context) => console.error(`flow ${flow.name}: ${context.phase}: ${String(error)}`),
    interpret: {
      step_run: (cmd) => runners.run(cmd.step).pipe(Effect.mapError((e) => Failed.make({ reason: e.reason }))),
    },
    terminal: (m) => m._tag !== "running",
  });
  const runtime = yield* handle.ready;
  return yield* runtime.done();
}, Effect.scoped);
