import {defineMachine} from "@demlik/tea";
import {run} from "@demlik/tea/effect";
// P5: a click fired with Effect.runFork after the run stopped. Where does the failure go?
import {Effect, Fiber} from "effect";

const counter = defineMachine({
	types: {model: {}, msg: {}},
	init: () => [{count: 0}, []],
	update: {inc: (s) => [{count: s.count + 1}, []]},
});
let rt;
const fiber = await new Promise((resolve) => {
	const f = Effect.runFork(
		Effect.scoped(
			Effect.gen(function* () {
				rt = yield* (yield* run(counter, {ctx: undefined})).ready;
				resolve(f);
				return yield* Effect.never;
			}),
		),
	);
});
await Effect.runPromise(Fiber.interrupt(fiber));

console.log("A: plain runFork after stop ->");
const a = Effect.runFork(rt.dispatch({type: "inc"}));
const ax = await Effect.runPromise(Fiber.await(a));
console.log(
	`   fiber ended: ${ax._tag}, error tag: ${ax.cause?.reasons?.[0]?.error?._tag ?? JSON.stringify(ax.cause).slice(0, 120)}`,
);
await new Promise((r) => setTimeout(r, 50));

console.log("B: runFork with Stopped caught, the rest reported ->");
const send = (msg) =>
	Effect.runFork(
		rt.dispatch(msg).pipe(
			Effect.catchTag("Stopped", () => Effect.void),
			Effect.tapCause((cause) =>
				Effect.sync(() => console.error("   reported:", String(cause).slice(0, 80))),
			),
		),
	);
const b = send({type: "inc"});
const bx = await Effect.runPromise(Fiber.await(b));
console.log(`   fiber ended: ${bx._tag}`);
