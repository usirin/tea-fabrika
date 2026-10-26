// Question 1's program: experiment 98's counter, unchanged, served on whichever object its parent
// hands it. It is given one `Ledger` and never learns which object holds its rows.
import {cast, Ledger, serve} from "@kampus/fabrika";
import {Duration, Effect} from "effect";
import {counterProgram} from "../98-tea-host-package/counter.ts";

export const NAME = "counter:1";

/** The counter's count, from its last saved state. */
export const countOf = Effect.gen(function* () {
	const l = yield* Ledger;
	const last = yield* l.readLast(`${NAME}/state`, 1);
	const data: unknown = JSON.parse(last[0]?.data ?? "{}");
	const state: unknown =
		typeof data === "object" && data !== null ? Reflect.get(data, "state") : null;
	const count: unknown =
		typeof state === "object" && state !== null ? Reflect.get(state, "count") : 0;
	return typeof count === "number" ? count : 0;
});

/** Register the counter, serve it, send it `n` messages, and wait until it counted them. */
export const runCounter = (holder: string, n: number) =>
	Effect.gen(function* () {
		const l = yield* Ledger;
		yield* l.register(NAME, holder);
		yield* serve({name: NAME, holder, program: counterProgram});
		const t0 = performance.now();
		for (let i = 0; i < n; i++) yield* cast(NAME, `m${i}`, {id: `m${i}`}, "sender");
		for (;;) {
			const c = yield* countOf;
			if (c >= n) return {count: c, ms: performance.now() - t0};
			yield* Effect.sleep(Duration.millis(20));
		}
	}).pipe(Effect.timeout(Duration.seconds(20)), Effect.scoped);
