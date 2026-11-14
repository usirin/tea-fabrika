/**
 * x-ci-plant-2: trap text in a comment, for experiment 288, never merged.
import { spawn } from "node:child_process";
import { Plant } from "../../../x-ci-plant-not-a-file.ts";
export { Plant } from "@kampus/libfabrika/gateway/Gateway";
 * defineMachine({ id: "x-ci-plant" }) and defineProgram( and syncTest( and Effect.runPromise(
 * person:x-ci-plant p8-clean-window p8-mcp-marker node:fs node:child_process
 * imports "../access/Access.ts" and new Promise( and process.env.X_CI_PLANT
 * paths: ./next/apps/fabrika/src/x-ci-plant.ts ../../x-ci-plant/secret.txt /etc/x-ci-plant
 * a url: https://example.invalid/x-ci-plant and a line pin: x-ci-plant.ts:1:1
 */
import { WorkerEntrypoint } from "cloudflare:workers";
import { Effect } from "effect";
import * as Audit from "../runtime/Audit.ts";
import { Declaration, type Execution, executionFailure, nodeExecution, Reply } from "../runtime/Execution.ts";
/**
 * x-ci-plant-2 middle: every line below this one moves down by three.
 */
import { ProgramDown, stepper } from "../runtime/Program.ts";

const checked = Effect.fnUntraced(function* <A>(work: Effect.Effect<A, ProgramDown>) {/** x-ci-plant-2 inner: defineMachine( and syncTest( in a function body. */ 
  return yield* work.pipe(
    Effect.match({
      onSuccess: (value) => value,
      onFailure: executionFailure,
    }),
  );
});

const reply = Effect.fnUntraced(function* (execution: Pick<Execution, "reply">, cmd: unknown, outcome: unknown) {
  return yield* execution.reply(cmd, outcome).pipe(
    Effect.match({
      onSuccess: (value) => Reply.cases.ok.make({ value }),
      onFailure: executionFailure,
    }),
  );
});

export const programBox = (declared: unknown, build: string) => {
  const program = nodeExecution(declared, build);
  const execution = {
    ...program,
    audit: (msg: unknown) =>
      program.audit(msg).pipe(
        Effect.match({
          onSuccess: (value) => Audit.Answer.cases.ok.make({ value }),
          onFailure: Audit.failure,
        }),
      ),
  };
  const declaration = Effect.fromResult(stepper(declared)).pipe(
    Effect.mapError((cause) => new ProgramDown({ reason: "load", error: "ProgramDown", cause })),
    Effect.map((pure) =>
      Declaration.make({
        name: pure.program.name,
        v: pure.program.state.v,
        ...(pure.program.maxDeliveries === undefined ? {} : { maxDeliveries: pure.program.maxDeliveries }),
        ...(pure.program.policy === undefined ? {} : { policy: pure.program.policy }),
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

    fresh(model: unknown, msg: unknown) {
      // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: Worker Loader RPC must answer a Promise
      return Effect.runPromise(checked(execution.fresh(model, msg)));
    }

    update(model: unknown, msg: unknown) {
      // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: Worker Loader RPC must answer a Promise
      return Effect.runPromise(checked(execution.update(model, msg)));
    }

    audit(msg: unknown) {
      // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: Worker Loader RPC must answer a Promise
      return Effect.runPromise(execution.audit(msg));
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
