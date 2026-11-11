// What a program runner is given, next/ (Tier 1, P11): the programs it may load, the door's
// checked writer, the watchers, the object's one alarm, and the recording flush. P12 wires the
// real ones to object calls, the Worker Loader and P37's sink; Node tests wire the same shapes.
import { type Outcome, type Tagged } from "@demlik/tea";
import { Context, Effect, Layer, Option, Schema } from "effect";
import {
  type Appended,
  type Archive,
  type LedgerError,
  type NotGranted,
  InputId,
  type RecordManager,
  type Session,
  type SigningRefused,
  type SinkError,
  SpanSink,
  Writer,
} from "../coordination/index.ts";
import { nodeExecution, type Execution, type Declaration } from "./Execution.ts";
import { type Patch } from "./Patch.ts";
import { ProgramDown, stepper, type Stepper } from "./Program.ts";

/** A function type whose parameters are checked both ways, as a method's are. */
type Code<A extends ReadonlyArray<unknown>, R> = { call(...args: A): R }["call"];

/** A view as JSON. One runner serves every program, so the type stays open: each program's own
 *  client decodes its view (P14). */
export type View = unknown;

/** What a watcher is sent: the whole view once, then one patch per installed step. `rev` is the
 *  inbox position of the last installed letter, so other streams leave no gaps. */
export type Update =
  | { readonly type: "whole"; readonly rev: number; readonly view: View }
  | {
      readonly type: "patch";
      readonly base: number;
      readonly rev: number;
      readonly patch: ReadonlyArray<Patch>;
    };

/** P10's delivery: its stable letter id, the stamped envelope, the writer's clock, the rev it had
 *  seen, and the saved trace context. Its shape is checked here; its authority stays with P10. */
export const Incoming = Schema.Struct({
  id: Schema.NonEmptyString,
  envelope: Schema.Struct({
    id: InputId,
    by: Writer,
    arrivedAt: Schema.Number,
    input: Schema.Unknown,
  }),
  sentAt: Schema.String,
  seen: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  span: Schema.Struct({ traceId: Schema.String, spanId: Schema.String }),
});
export type Incoming = typeof Incoming.Type;

/** A Cmd handler: it does the outside work and answers with tea's Outcome. */
export type Handler<R> = Code<[cmd: unknown], Effect.Effect<Outcome<unknown, unknown>, unknown, R>>;

/** An in-process program: its pure stepper, runner execution and allowed Cmd handlers. */
export type Loaded = {
  readonly stepper: Stepper;
  readonly execution: Execution;
  readonly declaration: Declaration;
  readonly handler: (cmd: string) => Option.Option<(cmd: unknown) => Effect.Effect<Outcome<unknown, unknown>, unknown>>;
};

/** The one Cmd that only the chaos program may run (P17, P27). */
const CHAOS_ONLY: Readonly<Record<string, string>> = { fire: "chaos" };

export class ProgramLoader extends Context.Service<
  ProgramLoader,
  { readonly load: (name: string, build?: string) => Effect.Effect<Loaded, ProgramDown> }
>()("@kampus/libfabrika/runtime/Entry.ProgramLoader") {
  /** The in-process loader, for Node: each program's declaration, decoded when it is loaded, and
   *  the handlers its Cmds may use. A handler names its Cmd; `fire` runs only for `chaos`. */
  static readonly layer = <R = never>(
    programs: Readonly<Record<string, unknown>>,
    handlers: Readonly<Record<string, Handler<R>>>,
  ): Layer.Layer<ProgramLoader, never, R> =>
    Layer.effect(
      ProgramLoader,
      Effect.gen(function* () {
        const context = yield* Effect.context<R>();
        return {
          load: Effect.fn("loader.load")(function* (name: string, build = "node") {
            if (!Object.hasOwn(programs, name)) {
              return yield* new ProgramDown({ reason: "no_program" });
            }

            const loaded = yield* Effect.fromResult(stepper(programs[name])).pipe(
              Effect.mapError(() => new ProgramDown({ reason: "load" })),
            );
            return {
              stepper: loaded,
              execution: nodeExecution(programs[name], build),
              declaration: {
                name: loaded.program.name,
                v: loaded.program.state.v,
                ...(loaded.program.maxDeliveries === undefined ? {} : { maxDeliveries: loaded.program.maxDeliveries }),
                writes: Object.fromEntries(
                  Object.entries(loaded.program.writes).map(([name, p]) => [name, { personOnly: p.personOnly }]),
                ),
                inputs: Object.fromEntries(
                  Object.entries(loaded.program.inputs).map(([name, p]) => [
                    name,
                    { write: p._tag === "write", personOnly: p._tag === "write" && p.personOnly },
                  ]),
                ),
                cmds: (loaded.program.machine.cmds ?? []).map((d) => d.cmdType),
              },
              handler: (cmd: string) => {
                const owner = CHAOS_ONLY[cmd];
                const run = Object.hasOwn(handlers, cmd) ? handlers[cmd] : undefined;

                if (run === undefined || (owner !== undefined && owner !== name)) {
                  return Option.none();
                }

                return Option.some((value: unknown) => run(value).pipe(Effect.provideContext(context)));
              },
            };
          }),
        };
      }),
    );
}

/** An event as it travels in a checked write: JSON with its case. */
export type Event = Schema.JsonObject & Tagged;

/** The door's checked edges (P10). `append` saves a delivered input in the inbox. `commit` writes a
 *  event under a signed session, and `own` under the process owner; both recheck admission. */
export class CheckedWriter extends Context.Service<
  CheckedWriter,
  {
    readonly sign?: (
      id: string,
      parent: string,
      kind: string,
    ) => Effect.Effect<Session, LedgerError | SigningRefused | NotGranted>;
    readonly append: (input: Incoming) => Effect.Effect<Appended, LedgerError | NotGranted>;
    readonly commit: (
      id: string,
      session: Session,
      stream: string,
      event: Event,
    ) => Effect.Effect<Appended, LedgerError | SigningRefused | NotGranted>;
    readonly own: (id: string, stream: string, event: Event) => Effect.Effect<Appended, LedgerError | SigningRefused>;
  }
>()("@kampus/libfabrika/runtime/Entry.CheckedWriter") {}

/** Sends a watcher its view. */
export class WatcherManager extends Context.Service<
  WatcherManager,
  { readonly publish: (client: string, update: Update) => Effect.Effect<void> }
>()("@kampus/libfabrika/runtime/Entry.WatcherManager") {}

/** The object's one alarm: the program's next wake time, or none. */
export class Alarm extends Context.Service<Alarm, { readonly set: (at: number | null) => Effect.Effect<void> }>()(
  "@kampus/libfabrika/runtime/Entry.Alarm",
) {}

/** Sends the process's ended spans on to its JobRecord, with its services captured at build time. */
export class Recording extends Context.Service<
  Recording,
  { readonly flush: Effect.Effect<unknown, LedgerError | SinkError> }
>()("@kampus/libfabrika/runtime/Entry.Recording") {
  static readonly layer: Layer.Layer<Recording, never, SpanSink | RecordManager | Archive> = Layer.effect(
    Recording,
    Effect.gen(function* () {
      const sink = yield* SpanSink;
      const context = yield* Effect.context<RecordManager | Archive>();
      return { flush: sink.flush.pipe(Effect.provideContext(context)) };
    }),
  );
}
