import { Context, Duration, Effect, Exit, Layer, ManagedRuntime, Scope, ScopedCache } from "effect";

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

/** The outer runtime owns only the holder; each entry acquires the retryable context. */
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
