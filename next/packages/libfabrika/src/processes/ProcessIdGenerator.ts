/**
 * Where a new process gets its id.
 *
 * @stability unstable
 */
import { Context, Effect, Layer } from "effect";
import * as Id from "../Id.ts";
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
    Effect.map(Id.Generator, (generator) => {
      const next = Effect.fn("process.next")(function* () {
        return yield* generator.next(Id.Process).pipe(Effect.orDie);
      });
      return { next: next() };
    }),
  ).pipe(Layer.provide(Id.Generator.layer));
}
