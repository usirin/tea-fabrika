/**
 * Worker Loader tail delivery. Only call metadata crosses into the Process object.
 *
 * @stability unstable
 */
import * as Cause from "effect/Cause";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";
import * as IsolateUsage from "../runtime/IsolateUsage.ts";
import { errorClass } from "../telemetry/Trace.ts";
import type { Env } from "./runtime.ts";

/**
 * Schema for attribution fixed when a program isolate is loaded.
 *
 * @stability experimental
 * @category schemas
 */
export const Props = Schema.Struct({ project: Schema.String, name: Schema.String, process: Schema.String });

/**
 * Binds the tail to the name and process being loaded, including a successor.
 *
 * @stability unstable
 * @category constructors
 */
export const bind = (ctx: DurableObjectState, props: typeof Props.Type): Fetcher => {
  // The library cannot name the app's mainModule in Cloudflare.GlobalProps.
  const exports = ctx.exports as { readonly IsolateTail: (options: { props: typeof Props.Type }) => Fetcher };
  return exports.IsolateTail({ props });
};

/**
 * Sends one batch to its name's object. A failed delivery records only the error class and is dropped.
 *
 * @stability unstable
 * @category combinators
 */
export const tail = Effect.fnUntraced(function* (env: Env, props: typeof Props.Type, items: ReadonlyArray<TraceItem>) {
  const work = Effect.gen(function* () {
    const rows = yield* Schema.decodeUnknownEffect(Schema.Array(IsolateUsage.Usage))(
      items.map((item) => {
        const event = item.event;
        const method = Predicate.hasProperty(event, "rpcMethod") ? event.rpcMethod : undefined;
        const outcome = item.outcome;
        return {
          process: props.process,
          method: Schema.is(IsolateUsage.Method)(method) ? method : "other",
          cpuMs: item.cpuTime,
          wallMs: item.wallTime,
          outcome: Schema.is(IsolateUsage.Outcome)(outcome) ? outcome : "other",
        };
      }),
    );
    const stub = env.PROCESS.getByName(JSON.stringify([props.project, props.name]));
    // oxlint-disable-next-line fabrika/no-promises -- edge: the platform's tail delivers its batch over Durable Object RPC
    yield* Effect.tryPromise({ try: () => stub.usage(rows), catch: (cause) => cause });
  });
  yield* work.pipe(
    Effect.catchCause((cause) =>
      Effect.gen(function* () {
        const kind = errorClass(Cause.squash(cause));
        const span = yield* Effect.makeSpan("isolate.tail", {
          attributes: { "fab.process": props.process, "error.type": kind },
        });
        span.end(yield* Clock.currentTimeNanos, Exit.fail(kind));
      }),
    ),
  );
});

/**
 * Runs the platform tail callback using its load-bound props.
 *
 * @stability unstable
 * @category combinators
 */
export const receive = (env: Env, props: unknown, items: Parameters<typeof tail>[2]) =>
  Schema.decodeUnknownEffect(Props)(props).pipe(Effect.flatMap((checked) => tail(env, checked, items)));
