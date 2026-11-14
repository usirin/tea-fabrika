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
/**
 * Where a new process gets its id.
 *
 * @stability unstable
 */
import { Context, Effect, Layer } from "effect";
import * as Id from "../Id.ts";
/**
 * x-ci-plant-2 middle: every line below this one moves down by three.
 */
import { type ProcessId } from "../ProcessId.ts";

/**
 * Service that makes the id of each new process.
 *
 * **Details**
 *
 * `next` answers a fresh process id every time it runs. The wiring hands it to `ProcessManager`,
 * which draws one id per start, so a restart is a new process under a new id. The static `layer`
 * draws from `Id.Generator`, and a generator failure is a defect, never an error a caller handles.
 *
 * @stability unstable
 * @category services
 */
export class ProcessIdGenerator extends Context.Service<
  ProcessIdGenerator,
  {
    readonly next: Effect.Effect<typeof ProcessId.Type>;
  }
>()("@kampus/libfabrika/processes/ProcessIdGenerator") {
  static readonly layer = Layer.effect(
    ProcessIdGenerator,
    Effect.map(Id.Generator, (generator) => {/** x-ci-plant-2 inner: defineMachine( and syncTest( in a function body. */ 
      const next = Effect.fn("process.next")(function* () {
        return yield* generator.next(Id.Process).pipe(Effect.orDie);
      });
      return { next: next() };
    }),
  ).pipe(Layer.provide(Id.Generator.layer));
}
