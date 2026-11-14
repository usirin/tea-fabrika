/**
 * The Process object's Layer: Alchemy's Effect object around `ProcessService`.
 *
 * @stability unstable
 */
import { DurableObjectState as ObjectState } from "@alchemy.run/cloudflare/Workers/DurableObjectState";
import { WorkerEnvironment } from "@alchemy.run/cloudflare/Workers/WorkerRuntime";
import { Context, Effect } from "effect";
import { LedgerError } from "../ledger/Ledger.ts";
import type { ProgramSource } from "./index.ts";
import { Process, type ProcessShape } from "./objects.ts";
import {
  configureProcess,
  type Env,
  processDescriptor,
  processRuntime,
  ProcessService,
  savedAlarm,
  settingsWire,
} from "./runtime.ts";

type Service = (typeof ProcessService)["Service"];

/** Keeps a `LedgerError` as the call's own failure. Any other failure dies, so the caller sees a
 *  rejected call with the thrown class and text, as it did when the class ran a Promise. */
const called = <A, E>(call: Effect.Effect<A, E>): Effect.Effect<A, LedgerError> =>
  call.pipe(
    Effect.catch((error): Effect.Effect<never, LedgerError> =>
      error instanceof LedgerError ? Effect.fail(error) : Effect.die(error),
    ),
  );

/**
 * Layer that provides the Process object: it takes what the platform gives an instance and hands
 * the alarm slot and every call to `ProcessService`.
 *
 * **Details**
 *
 * `programs` are the built programs the object's runner loads. The service is built on the first
 * slot or call that needs it, kept once the build succeeds, and built again after a failed one.
 * The Layer starts no timer and no fiber, so an idle instance sleeps.
 *
 * The alarm slot has no failure type, so a failed alarm dies: the bridge rejects, and the platform
 * delivers the alarm again. A call fails with a `LedgerError` as itself, and any other failure of a
 * call dies too. `abort` resets the instance, as the platform's own abort does.
 *
 * @stability unstable
 * @category layers
 */
export const layer = (options: { readonly programs: Readonly<Record<string, ProgramSource>> }) =>
  Process.make(
    Effect.gen(function* () {
      const state = yield* ObjectState;
      const env = yield* WorkerEnvironment;
      const bindings: Env = {
        INSTANCE: env.INSTANCE,
        PROJECT: env.PROJECT,
        PROCESS: env.PROCESS,
        CONNECTION: env.CONNECTION,
        RECORD: env.RECORD,
        LOADER: env.LOADER,
        MEASUREMENTS: env.MEASUREMENTS,
      };
      // oxlint-disable-next-line fabrika/no-type-assertions -- edge: raw state until S5 and S6; not reported, 0042 amendment 2026-11-09
      const raw = state.raw as unknown as DurableObjectState;
      // The runtime builds the service on first use and builds it again after a failure. It is
      // the same one the plain class held, so it folds into S1's ObjectService helper later.
      const runtime = settingsWire(processRuntime(raw, bindings, options.programs).contextEffect);
      const service = runtime.contextEffect.pipe(Effect.map((context) => Context.get(context, ProcessService)));
      const use = <A, E>(call: (process: Service) => Effect.Effect<A, E>) => called(service.pipe(Effect.flatMap(call)));

      return Effect.succeed({
        alarm: () =>
          service.pipe(
            Effect.flatMap((process) => process.alarm()),
            Effect.orDie,
          ),
        usage: (rows) => use((process) => process.usage(rows)),
        configure: (descriptor, drain) => called(configureProcess(raw, descriptor, runtime, drain)),
        descriptor: () => called(processDescriptor(raw)),
        msg: (input) => use((process) => process.msg(input)),
        open: (client) => use((process) => process.open(client)),
        mailed: (trace) => use((process) => process.mailed(trace)),
        due: (at) => use((process) => process.due(at)),
        restart: (request) => use((process) => process.restart(request)),
        activity: (value) => use((process) => process.activity(value)),
        recover: () => use((process) => process.recover()),
        savedAlarm: () => called(savedAlarm(raw)),
        abort: () => state.abort("storage wake"),
      } satisfies ProcessShape);
    }),
  );
