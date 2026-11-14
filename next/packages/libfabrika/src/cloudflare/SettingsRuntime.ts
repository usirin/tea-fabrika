/**
 * x-ci-plant-1: a comment-only plant for experiment 288, never merged.
 *
 * Line 01 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 02 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 03 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 04 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 05 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 06 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 07 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 08 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 09 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 10 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 11 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 12 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 13 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 14 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 15 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 16 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 17 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 18 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 19 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 20 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 21 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 22 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 23 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 24 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 */
/**
 * A runtime for one layer whose build can be tried again after it fails.
 *
 * @stability unstable
 */
import { Context, Duration, Effect, Exit, Layer, ManagedRuntime, Scope, ScopedCache } from "effect";

/**
 * Creates a one-slot cache that builds `ready` on its first read and keeps the built context.
 *
 * **Details**
 *
 * A build that succeeds is kept until the cache's scope closes. A build that fails is not kept:
 * its scope is closed, and the next read builds the layer again. What the layer itself needs is
 * taken once, when the cache is made.
 *
 * @stability unstable
 * @category constructors
 */
export const make = <ROut, E, RIn>(ready: Layer.Layer<ROut, E, RIn>) =>
  ScopedCache.makeWith({
    capacity: 1,
    requireServicesAt: "construction",
    lookup: (_key: void) =>
      Effect.gen(function* () {
        const memoMap = yield* Layer.makeMemoMap;
        const scope = yield* Scope.fork(yield* Effect.scope);
        return yield* Layer.buildWithMemoMap(ready, memoMap, scope).pipe(
          Effect.onExit((exit: Exit.Exit<Context.Context<ROut>, E>) =>
            Exit.isFailure(exit) ? Scope.close(scope, exit) : Effect.void,
          ),
        );
      }),
    timeToLive: (exit: Exit.Exit<Context.Context<ROut>, E>, _key: void) =>
      Exit.isSuccess(exit) ? Duration.infinity : Duration.zero,
  });

/**
 * Creates a runtime for `ready` that builds it on first use and builds it again after a failure.
 *
 * **When to use**
 *
 * Use when a later call must be able to succeed after an earlier build failed. A plain
 * `ManagedRuntime` builds its layer once and keeps a failed build.
 *
 * **Details**
 *
 * Every use reads the built context through `make`'s cache. A good build is shared by all later
 * uses. A failed build is not kept, so the next use builds again. `dispose` closes the cache and
 * the build with it.
 *
 * @stability unstable
 * @category constructors
 */
export const runtime = <ROut, E>(ready: Layer.Layer<ROut, E>) => {
  class Holder extends Context.Service<Holder, { readonly get: Effect.Effect<Context.Context<ROut>, E> }>()(
    "@kampus/libfabrika/cloudflare/SettingsRuntime.Holder",
  ) {}
  const owner = ManagedRuntime.make(
    Layer.effectContext(
      make(ready).pipe(
        Effect.map((holder) => {
          return Holder.context({ get: ScopedCache.get(holder, undefined) });
        }),
      ),
    ),
  );
  const context = owner.contextEffect.pipe(Effect.flatMap((services) => Context.get(services, Holder).get));
  const provide = <A, E2>(work: Effect.Effect<A, E2, ROut>) =>
    context.pipe(Effect.flatMap((services) => Effect.provideContext(work, services)));
  return {
    provide,
    context,
    contextEffect: context,
    disposeEffect: owner.disposeEffect,
    runPromise: <A, E2>(work: Effect.Effect<A, E2, ROut>) =>
      // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: object and Worker entry adapters run through their owning runtime
      owner.runPromise(provide(work)),
    runPromiseExit: <A, E2>(work: Effect.Effect<A, E2, ROut>) =>
      // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: object adapters expose their runtime's checked exit
      owner.runPromiseExit(provide(work)),
    // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: the object owner closes its runtime scope
    dispose: () => Effect.runPromise(owner.disposeEffect),
  };
};
