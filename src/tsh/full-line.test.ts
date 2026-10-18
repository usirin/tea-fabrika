import {Deferred, Duration, Effect, Layer, Schema, Stream} from "effect";
import {describe, expect, it} from "vitest";
import {ear} from "../program/ear.ts";
import {CAPACITY, defineProgram, start, tell} from "../program/program.ts";
import {input} from "../program/shape.ts";
import {memoryStorage} from "../program/storage.ts";
import {JobStorage, listed, Programs, programList} from "./programs.ts";
import {type Printed, type Ready, tsh} from "./shell.ts";
import {SMALL} from "./small.ts";

// A full line, as a person meets it in `jobs` (after experiment 79): `seq`
// piped into a program that has stopped reading. seq sleeps on the full
// line, as a writer on a full Unix pipe does, and nothing is an error, so
// `jobs` is the one place it shows. Once the reader reads again, the rows go.

/** Reads nothing until `go`, then every number; then holds on until `hold`, so the job stays in the table. */
const lazyOf = (go: Deferred.Deferred<void>, hold: Deferred.Deferred<void>) =>
	defineProgram({
		name: "lazy",
		description: "Reads its numbers once it is let go, then waits.",
		inputs: {n: input(Schema.Int, "A number.")},
		outputs: {},
		main: ({inputs}) =>
			Deferred.await(go).pipe(
				Effect.andThen(inputs.n.pipe(Stream.runDrain)),
				Effect.andThen(Deferred.await(hold)),
			),
	});

const session = (go: Deferred.Deferred<void>, hold: Deferred.Deferred<void>) =>
	Effect.gen(function* () {
		const printed = ear<Printed>();
		const ready = ear<Ready>();
		const storage = memoryStorage();
		const list = programList([...SMALL, listed(lazyOf(go, hold), Layer.empty)]);
		const started = yield* start(
			tsh,
			{show: "short"},
			{printed: printed.hear, ready: ready.hear},
			{id: "tsh:full-line", storage},
		).pipe(Effect.provideService(JobStorage, storage), Effect.provideService(Programs, list));
		if (started.kind !== "running") return yield* Effect.die("tsh did not start");
		let told = 0;
		const line = (text: string) =>
			Effect.gen(function* () {
				const from = printed.values.length;
				expect(tell(started.run, "line", text)).toBe("queued");
				told += 1;
				const all = yield* ready.upTo(told);
				return {status: all[told - 1]?.status, out: printed.values.slice(from).map((p) => p.text)};
			});
		/** `jobs`, again and again, until its rows pass `until`. */
		const jobsUntil = (until: (rows: readonly string[]) => boolean) => {
			let last: readonly string[] = [];
			return Effect.gen(function* () {
				for (;;) {
					last = (yield* line("jobs")).out;
					if (until(last)) return last;
					yield* Effect.sleep(Duration.millis(5));
				}
			}).pipe(
				Effect.timeout(Duration.seconds(3)),
				Effect.catch(() => Effect.die(`jobs never got there; it showed:\n${last.join("\n")}`)),
			);
		};
		return {started, line, jobsUntil};
	});

describe("jobs shows a full line", () => {
	it("seq piped into a reader that stopped: seq waits for room, lazy's input is full; both rows go once lazy reads", async () => {
		const seen = await Effect.runPromise(
			Effect.gen(function* () {
				const go = yield* Deferred.make<void>();
				const hold = yield* Deferred.make<void>();
				const {started, line, jobsUntil} = yield* session(go, hold);
				expect((yield* line("seq --to 3000 | lazy &")).status).toBe(0);
				const stuck = yield* jobsUntil((rows) => rows.some((r) => r.includes("waiting for room")));
				yield* Deferred.succeed(go, undefined);
				// Read when the reader has drained the line: seq has ended and lazy holds on, so the job is still in the table.
				const moving = yield* jobsUntil(
					(rows) => rows.length === 1 && rows[0]?.startsWith("[1] running") === true,
				);
				yield* Deferred.succeed(hold, undefined);
				started.close("line");
				yield* started.run.ended;
				return {stuck, moving};
			}).pipe(Effect.scoped),
		);
		expect(seen.stuck).toEqual([
			"[1] running   seq --to 3000 | lazy",
			"      seq   waiting for room: lazy's input n is full",
			`      lazy  input n full: ${CAPACITY} unread, 1 waiting`,
		]);
		expect(seen.moving).toEqual(["[1] running   seq --to 3000 | lazy"]);
	});
});
