import { WorkerEntrypoint } from "cloudflare:workers";
import { Effect } from "effect";
import { Declaration, type Execution, executionFailure, nodeExecution, Reply } from "../app/execution.ts";
import { ProgramDown, stepper } from "../app/program.ts";

const checked = Effect.fnUntraced(function* <A>(work: Effect.Effect<A, ProgramDown>) {
  return yield* work.pipe(
    Effect.match({
      onSuccess: (value) => value,
      onFailure: executionFailure,
    }),
  );
});

const reply = Effect.fnUntraced(function* (execution: Execution, cmd: unknown, outcome: unknown) {
  return yield* execution.reply(cmd, outcome).pipe(
    Effect.match({
      onSuccess: (value) => Reply.cases.ok.make({ value }),
      onFailure: executionFailure,
    }),
  );
});

export const programBox = (declared: unknown, build: string) => {
  const execution = nodeExecution(declared, build);
  const declaration = Effect.fromResult(stepper(declared)).pipe(
    Effect.mapError(() => new ProgramDown({ reason: "load" })),
    Effect.map((pure) =>
      Declaration.make({
        name: pure.program.name,
        v: pure.program.state.v,
        ...(pure.program.maxDeliveries === undefined ? {} : { maxDeliveries: pure.program.maxDeliveries }),
        writes: Object.fromEntries(
          Object.entries(pure.program.writes).map(([name, p]) => [name, { personOnly: p.personOnly }]),
        ),
        inputs: Object.fromEntries(
          Object.entries(pure.program.inputs).map(([name, p]) => [
            name,
            { write: p._tag === "write", personOnly: p._tag === "write" && p.personOnly },
          ]),
        ),
        cmds: (pure.program.machine.cmds ?? []).map((d) => d.cmdType),
      }),
    ),
  );
  return class ProgramBox extends WorkerEntrypoint {
    describe() {
      // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: Worker Loader RPC must answer a Promise
      return Effect.runPromise(declaration);
    }

    init(saved: unknown) {
      // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: Worker Loader RPC must answer a Promise
      return Effect.runPromise(checked(execution.init(saved)));
    }

    step(model: unknown, msg: unknown) {
      // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: Worker Loader RPC must answer a Promise
      return Effect.runPromise(checked(execution.step(model, msg)));
    }

    fold(model: unknown, msg: unknown) {
      // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: Worker Loader RPC must answer a Promise
      return Effect.runPromise(checked(execution.fold(model, msg)));
    }

    upgrade(saved: unknown) {
      // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: Worker Loader RPC must answer a Promise
      return Effect.runPromise(checked(execution.upgrade(saved)));
    }

    reply(cmd: unknown, outcome: unknown) {
      // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: Worker Loader RPC must answer a Promise
      return Effect.runPromise(reply(execution, cmd, outcome));
    }

    check(kind: string, event: unknown) {
      // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: Worker Loader RPC must answer a Promise
      return Effect.runPromise(checked(execution.check(kind, event)));
    }

    admit(m: unknown) {
      // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: Worker Loader RPC must answer a Promise
      return Effect.runPromise(checked(execution.admit(m)));
    }
  };
};
