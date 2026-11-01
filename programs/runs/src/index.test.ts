import {Ledger, memoryStorage, offer, start, streams} from "@kampus/fabrika-old";
import {memoryService} from "@kampus/fabrika-old/memory";
import {nameOf} from "@kampus/pipeline/tickets/ticket";
import {Author, type One, oneOf, pullRequestsOf} from "@tea-fabrika/tracker";
import {OWNER} from "@tea-fabrika/tracker/seven";
import {Effect, Layer, Option, Stream} from "effect";
import {describe, expect, it} from "vitest";
import {runs} from "./index.ts";

// The runs program with no window, on a ledger in memory with two tickets: it lays out the
// ticket its flag names, then each one its input sends, and its input's end changes nothing.

const file = (ledger: Ledger["Service"], n: number, title: string) =>
	Effect.gen(function* () {
		yield* ledger.register(nameOf(n), "user:owner");
		yield* ledger.send(streams(nameOf(n)).inbox, "filed", {
			kind: "filed",
			writer: "user:owner",
			data: {type: "filed", title, body: ""},
		});
	});

const session = (ledger: Ledger["Service"], ticket: number | undefined) =>
	Effect.gen(function* () {
		const started = yield* start(runs, {ticket}, {}, {id: "runs:test", storage: memoryStorage()});
		if (started.kind !== "running") return yield* Effect.die("runs did not start");
		const until = (ok: (one: One) => boolean) =>
			started.run.machines.tickets.changes.pipe(
				Stream.filter((s) => s !== null),
				Stream.map(oneOf),
				Stream.filter(ok),
				Stream.runHead,
				Effect.map(Option.getOrThrow),
			);
		return {started, until};
	}).pipe(
		Effect.provide(
			Layer.mergeAll(
				Layer.succeed(Ledger, ledger),
				Layer.succeed(Author, OWNER),
				pullRequestsOf([]),
			),
		),
	);

describe("the runs program", () => {
	it("lays out the flag's ticket, then each ticket its input sends, and keeps the last when it ends", async () => {
		const ledger = memoryService();
		const seen = await Effect.runPromise(
			Effect.gen(function* () {
				yield* file(ledger, 3, "Docs typo");
				yield* file(ledger, 7, "Login fails");
				const {started, until} = yield* session(ledger, 3);
				const first = yield* until((o) => o.ticket !== null);
				yield* offer(started.run, "ticket", 7);
				const second = yield* until((o) => o.ticket?.number === 7);
				// Its input ends, as when the program before it in a line ends: it lays out 7 still.
				started.close("ticket");
				yield* Effect.sleep("20 millis");
				const still = yield* until(() => true);
				const word = yield* offer(started.run, "quit", null);
				return {first, second, still, word, ended: (yield* started.run.ended).kind};
			}).pipe(Effect.scoped),
		);
		expect(seen.first.ticket?.title).toBe("Docs typo");
		expect(seen.second.ticket?.title).toBe("Login fails");
		expect(seen.still.number).toBe(7);
		expect(seen.word).toBe("queued");
		expect(seen.ended).toBe("ended");
	});

	it("waits for a ticket when no flag names one", async () => {
		const ledger = memoryService();
		const seen = await Effect.runPromise(
			Effect.gen(function* () {
				yield* file(ledger, 7, "Login fails");
				const {started, until} = yield* session(ledger, undefined);
				const none = yield* until((o) => o.ready);
				yield* offer(started.run, "ticket", 7);
				const seven = yield* until((o) => o.ticket !== null);
				// The window's inputs end, as when its tile closes: so does the program.
				started.close("choose");
				started.close("quit");
				return {none, seven, ended: (yield* started.run.ended).kind};
			}).pipe(Effect.scoped),
		);
		expect(seen.none.number).toBeNull();
		expect(seen.seven.number).toBe(7);
		expect(seen.ended).toBe("ended");
	});
});
