// Exam amendment, P33 / ticket 252. Replaces P9's per-build start identity only.
// Mail, writer fields, ledger refusals and lazy layer failures stay covered.
import {describe, expect, it} from "@effect/vitest";
import {Effect, Layer, Stream} from "effect";
import {LedgerTransaction} from "../data/ledger-transaction.ts";
import {Doorbell, Ledger, LedgerError} from "../data/ledger.ts";
import {Mailbox} from "./mailbox.ts";
import {CoordinationLayer, ProcessManager} from "./process-manager.ts";
import {
	A,
	B,
	brain,
	CODE,
	data,
	first,
	from,
	ids,
	manager,
	read,
	storage,
} from "./process.test-support.ts";

describe("p21 amended by p79, starts have request IDs and process IDs", () => {
	it.effect("plant, key by build hash: two starts on one build have separate lives", () => {
		const store = storage();
		return Effect.gen(function* () {
			const processes = yield* ProcessManager;
			const a = yield* processes.start(first(), from());
			const b = yield* processes.start(first("start:counter:2", "counter:2"), from());
			expect(a.process).toBe(A);
			expect(b.process).toBe(B);
			const started = (yield* read("counter:1")).filter((row) => row._tag === "started");
			expect(started).toHaveLength(1);
			expect(started[0]).toMatchObject({
				_tag: "started",
				stream: "counter:1",
				body: {process: A, name: "counter:1", ...CODE},
				...from(),
			});
			expect(started[0]?.rev).toBe(a.rev);
			expect((yield* read("counter:2")).filter((row) => row._tag === "started")).toHaveLength(1);
		}).pipe(Effect.provide(manager(store)));
	});
	it.effect("plant, allocate on retry: a lost answer gets the first process and placing", () => {
		const store = storage();
		const generated = ids(A);
		return Effect.gen(function* () {
			const processes = yield* ProcessManager;
			const a = yield* processes.start(first(), from());
			expect(yield* processes.start(first(), from({sentAt: "later"}))).toEqual(a);
			expect((yield* Effect.flip(processes.start(first(), from({parent: null})))).why).toBe(
				"id_reused",
			);
			expect((yield* read("counter:1")).filter((row) => row._tag === "started")).toHaveLength(1);
			expect(generated.calls()).toBe(1);
		}).pipe(Effect.provide(manager(store, brain(), generated.next)));
	});
	it.effect("passes a ledger refusal up without writing a partial reservation", () => {
		const store = storage();
		return Effect.gen(function* () {
			const processes = yield* ProcessManager;
			expect((yield* Effect.flip(processes.start(first(), from({seen: 5})))).why).toBe("refused");
			expect(store.rows()).toEqual([]);
		}).pipe(Effect.provide(manager(store)));
	});
});

describe("p21, CoordinationLayer", () => {
	it.effect("gives mail and starts over the same ledger", () => {
		const store = storage();
		return Effect.gen(function* () {
			const mailbox = yield* Mailbox;
			const processes = yield* ProcessManager;
			const a = yield* processes.start(first(), from());
			expect(
				yield* mailbox.send("counter:1", "letter-a", {type: "save"}, from({seen: a.rev})),
			).toMatchObject({_tag: "placed", pos: 1});
			expect(
				(yield* Stream.runCollect(mailbox.receive("counter:1", 0))).map((letter) => letter.id),
			).toEqual(["letter-a"]);
		}).pipe(
			Effect.provide(CoordinationLayer(brain(), ids(A).next).pipe(Layer.provide(data(store.sql)))),
		);
	});
	for (const why of ["storage", "unreachable"] as const) {
		it.effect(`plant, fail at layer build: ${why} stays a per-call failure`, () => {
			const failure = new LedgerError({why});
			const broken = Layer.mergeAll(
				Layer.succeed(Ledger, {
					append: () => Effect.fail(failure),
					read: () => Stream.fail(failure),
					wait: () => Effect.fail(failure),
				}),
				Layer.succeed(LedgerTransaction, {run: () => Effect.fail(failure)}),
				Layer.succeed(Doorbell, {ring: () => Effect.void}),
			);
			return Effect.gen(function* () {
				const processes = yield* ProcessManager;
				const mailbox = yield* Mailbox;
				expect((yield* Effect.flip(processes.start(first(), from()))).why).toBe(why);
				expect((yield* Effect.flip(mailbox.send("counter:1", "letter-a", 1, from()))).why).toBe(
					why,
				);
			}).pipe(Effect.provide(CoordinationLayer(brain(), ids(A).next).pipe(Layer.provide(broken))));
		});
	}
});
