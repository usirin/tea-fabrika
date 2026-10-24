import {call, memoryStorage, readInput, start, tell, viewOf} from "@kampus/fabrika";
import {Effect, Fiber, Stream} from "effect";
import {describe, expect, it} from "vitest";
import {counter} from "./index.ts";

// The counter with no window: told its presses, as a window would send them, it counts and
// says the count; its view follows its count.

const keeping = () => ({id: "counter:test", storage: memoryStorage()});

describe("counter", () => {
	it("counts the pluses until done, and says the count", async () => {
		const called = await Effect.runPromise(
			call(counter, {}, {told: {press: ["plus", "plus", "done", "plus"]}, keeping: keeping()}).pipe(
				Effect.scoped,
			),
		);
		expect(called.kind === "called" && called.heard).toEqual([{name: "n", value: 2}]);
	});

	it("shows its count to its window as it goes", async () => {
		const views = await Effect.runPromise(
			Effect.gen(function* () {
				const started = yield* start(counter, {}, {}, keeping());
				if (started.kind !== "running") return yield* Effect.die("counter did not start");
				const view = viewOf(counter);
				if (view === undefined) return yield* Effect.die("counter has no view");
				const seen = yield* started.run.machines.count.changes.pipe(
					Stream.filter((s) => s !== null),
					Stream.map(view.of),
					Stream.take(2),
					Stream.runCollect,
					Effect.forkScoped,
				);
				expect(yield* tell(started.run, "press", "plus")).toBe("queued");
				const shown = yield* Fiber.join(seen);
				yield* tell(started.run, "press", "done");
				yield* started.run.ended;
				return shown;
			}).pipe(Effect.scoped),
		);
		expect(views).toEqual([{n: 0}, {n: 1}]);
	});

	it("reads what its window sends, and refuses a press it does not know", () => {
		expect(readInput(counter, {type: "press", value: "done"}).kind).toBe("read");
		expect(readInput(counter, {type: "press", value: "minus"}).kind).toBe("refused");
	});
});
