import {Deferred, Effect} from "effect";

// A listener for tests: it keeps what it hears, so a test can wait until it
// has heard enough. Give `hear` to `start`, so it is in place before `main`
// begins and hears every value from the first.
//
//   const outcomes = ear<Shipped>();
//   const started = yield* start(shipProgram, {mode: "write"}, {outcome: outcomes.hear});
//   tell(started.run, "pr", url);
//   yield* outcomes.upTo(1);          // the first outcome, once it is heard

export function ear<T>() {
	const values: T[] = [];
	let waiting: {readonly n: number; readonly done: Deferred.Deferred<readonly T[]>}[] = [];
	const hear = (value: T) => {
		values.push(value);
		for (const w of waiting)
			if (values.length >= w.n) Deferred.doneUnsafe(w.done, Effect.succeed(values.slice(0, w.n)));
		waiting = waiting.filter((w) => values.length < w.n);
	};
	/** The first `n` values heard, once there are that many. */
	const upTo = (n: number) =>
		Effect.gen(function* () {
			if (values.length >= n) return values.slice(0, n);
			const done = yield* Deferred.make<readonly T[]>();
			waiting.push({n, done});
			return yield* Deferred.await(done);
		});
	return {values, hear, upTo};
}
