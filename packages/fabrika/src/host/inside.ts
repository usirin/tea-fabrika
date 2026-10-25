// The `Ledger` of a Durable Object reached the way a Worker reaches it: through its binding, by
// RPC, past the door, through the object's `call`. Each method takes the writer and the holder its
// caller gives, as the ledger's own methods do (`durable-object.ts`).
//
// For tests that run the ledger's laws on the Durable Object itself: the laws name their own
// writers ("ledger" among them, to see it refused), which the door would never let a request say.
// Nothing on the network reaches this way in. It needs the Miniflare that runs the object in this
// process.
//
// The doorbell here is a poll, every 50 ms: an RPC stub holds no socket. `watch` may ring more
// than once per write, which the service allows.
import {Duration, Effect, Layer, Stream} from "effect";
import type {Miniflare} from "miniflare";
import {fromRaw, Ledger, LedgerUnreachable, rawOf, type WireCall} from "./ledger.ts";

/** The method `name` of `o`, bound to it; an error when `o` has none. */
const methodOf =
	(o: object, name: string) =>
	(...args: readonly unknown[]): unknown => {
		const fn: unknown = Reflect.get(o, name);
		if (typeof fn !== "function") throw new Error(`no method ${name}`);
		return Reflect.apply(fn, o, args);
	};

/** The ledger named `ledger`, in the Miniflare `mf`, over its `LEDGER` binding. */
export const layerInside = (mf: Pick<Miniflare, "getDurableObjectNamespace">, ledger: string) =>
	Layer.effect(
		Ledger,
		Effect.gen(function* () {
			// Miniflare's own types for a namespace do not resolve without workerd's: the two methods
			// used are found by name, and each answer is checked.
			const ns: object = yield* Effect.promise(() => mf.getDurableObjectNamespace("LEDGER"));
			const stub: unknown = methodOf(ns, "get")(methodOf(ns, "idFromName")(ledger));
			if (typeof stub !== "object" || stub === null) {
				return yield* Effect.die(new Error("the LEDGER binding gave no object"));
			}
			const unreachable = (method: string) => (e: unknown) =>
				new LedgerUnreachable({method, message: e instanceof Error ? e.message : String(e)});
			const call: WireCall = (method, args) =>
				// One round trip: the object's `call` answers as text (an object answer would come back
				// as a proxy, a round trip per field).
				Effect.tryPromise({
					try: async (): Promise<unknown> => methodOf(stub, "call")(method, args),
					catch: unreachable(method),
				}).pipe(
					Effect.flatMap((text) =>
						typeof text === "string"
							? Effect.try({try: (): unknown => JSON.parse(text), catch: unreachable(method)})
							: Effect.fail(unreachable(method)(`${method} gave no text`)),
					),
				);
			const watch = () => Stream.tick(Duration.millis(50));
			return fromRaw(rawOf(call, watch));
		}),
	);
