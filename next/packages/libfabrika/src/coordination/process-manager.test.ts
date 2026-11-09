// Exam amendment, P33 / ticket 252. Replaces P9's per-build start identity only.
// Mail, writer fields, ledger refusals and lazy layer failures stay covered.
import {describe, expect, it} from "@effect/vitest";
import {Cause, Effect, Layer, Stream, Tracer} from "effect";
import * as fc from "fast-check";
import {LedgerTransaction} from "../data/ledger-transaction.ts";
import {Doorbell, Ledger, LedgerError} from "../data/ledger.ts";
import {Mailbox} from "./mailbox.ts";
import {CoordinationLayer, ProcessManager} from "./process-manager.ts";
import {
	A,
	B,
	brain,
	CODE as originalCode,
	data,
	events,
	first as makeFirst,
	from,
	ids,
	manager,
	storage,
} from "./process.test-support.ts";

const hash = fc.string({minLength: 1, maxLength: 80});
const fixture = (hash: string) => {
	const CODE = {...originalCode, hash};
	return {CODE, first: (id?: string, name?: string) => makeFirst(id, name, CODE)};
};
const check = <A, E, R>(
	arb: fc.Arbitrary<A>,
	examples: A[],
	law: (a: A) => Effect.Effect<void, E, R>,
) =>
	Effect.gen(function* () {
		const context = yield* Effect.context<R>();
		yield* Effect.promise(() =>
			fc.assert(
				fc.asyncProperty(arb, (a) =>
					Effect.runPromise(law(a).pipe(Effect.provideContext(context))),
				),
				{
					seed: 119120,
					numRuns: 40,
					includeErrorInReport: true,
					examples: examples.map((a): [A] => [a]),
				},
			),
		);
	});

describe("p21 amended by p79, starts have request IDs and process IDs", () => {
	it.effect("each exit ends process.exit with the real process tag", () =>
		check(hash, [], (reason) => {
			const store = storage();
			const spans: Tracer.NativeSpan[] = [];
			const tracer = Tracer.make({
				span: (options) => {
					const span = new Tracer.NativeSpan(options);
					spans.push(span);
					return span;
				},
			});
			return Effect.gen(function* () {
				const processes = yield* ProcessManager;
				yield* processes.start(makeFirst(), from());
				yield* processes.exit(A, reason, from());
				const exits = spans.filter((s) => s.name === "process.exit" && s.status._tag === "Ended");
				expect(exits).toHaveLength(1);
				expect(exits[0]?.attributes.get("fab.process")).toBe(A);
			}).pipe(Effect.provide(manager(store)), Effect.withTracer(tracer));
		}),
	);
	it.effect("fresh receive refuses missing and ended lives with the typed ended error", () =>
		check(hash, [], (reason) => {
			const store = storage();
			return Effect.gen(function* () {
				const processes = yield* ProcessManager;
				yield* processes.start(makeFirst(), from());
				yield* processes.exit(A, reason, from());
				for (const process of [A, B]) {
					const result = yield* Effect.exit(Stream.runCollect(processes.receive(process, 0)));
					expect(result._tag, "fresh receive refuses a life that is not live").toBe("Failure");
					if (result._tag === "Failure")
						expect(Cause.squash(result.cause)).toMatchObject({
							_tag: "ProcessError",
							reason: "ended",
						});
				}
			}).pipe(Effect.provide(manager(store)));
		}),
	);
	it.effect("plant, key by build hash: two starts on one build have separate lives", () =>
		check(hash, ["build-a"], (hash) => {
			const {CODE, first} = fixture(hash);
			const store = storage();
			return Effect.gen(function* () {
				const processes = yield* ProcessManager;
				const a = yield* processes.start(first(), from());
				const b = yield* processes.start(first("start:counter:2", "counter:2"), from());
				expect(a.process).toBe(A);
				expect(b.process).toBe(B);
				const started = (yield* events("counter:1")).filter((row) => row._tag === "started");
				expect(started).toHaveLength(1);
				expect(started[0]).toMatchObject({
					_tag: "started",
					stream: "processes/counter:1",
					body: {process: A, name: "counter:1", ...CODE},
					...from(),
				});
				expect(started[0]?.rev).toBe(a.rev);
				expect((yield* events("counter:2")).filter((row) => row._tag === "started")).toHaveLength(
					1,
				);
			}).pipe(Effect.provide(manager(store)));
		}),
	);
	it.effect("plant, allocate on retry: a lost answer gets the first process and placing", () =>
		check(hash, ["build-a"], (hash) => {
			const {first} = fixture(hash);
			const store = storage();
			const generated = ids(A);
			return Effect.gen(function* () {
				const processes = yield* ProcessManager;
				const a = yield* processes.start(first(), from());
				expect(yield* processes.start(first(), from({sentAt: "later"}))).toEqual(a);
				expect((yield* Effect.flip(processes.start(first(), from({parent: null})))).reason).toBe(
					"id_reused",
				);
				expect(
					(yield* Effect.flip(processes.start(first(), from({for: "other-person"})))).reason,
				).toBe("id_reused");
				expect((yield* events("counter:1")).filter((row) => row._tag === "started")).toHaveLength(
					1,
				);
				expect(generated.calls()).toBe(1);
			}).pipe(Effect.provide(manager(store, brain(), generated.next)));
		}),
	);
	it.effect("passes a ledger refusal up without writing a partial reservation", () =>
		check(hash, ["build-a"], (hash) => {
			const {first} = fixture(hash);
			const store = storage();
			return Effect.gen(function* () {
				const processes = yield* ProcessManager;
				expect((yield* Effect.flip(processes.start(first(), from({seen: 5})))).reason).toBe(
					"refused",
				);
				expect(store.rows()).toEqual([]);
			}).pipe(Effect.provide(manager(store)));
		}),
	);
});

describe("p21, CoordinationLayer", () => {
	it.effect("gives mail and starts over the same ledger", () =>
		check(fc.jsonValue(), [{type: "save"}], (m) => {
			const {first} = fixture("build-a");
			const store = storage();
			return Effect.gen(function* () {
				const mailbox = yield* Mailbox;
				const processes = yield* ProcessManager;
				const a = yield* processes.start(first(), from());
				expect(yield* mailbox.send("counter:1", "letter-a", m, from({seen: a.rev}))).toMatchObject({
					_tag: "placed",
					pos: 1,
				});
				expect(
					(yield* Stream.runCollect(mailbox.receive("counter:1", 0))).map((letter) => letter.id),
				).toEqual(["letter-a"]);
			}).pipe(
				Effect.provide(
					CoordinationLayer(brain(), ids(A).next).pipe(Layer.provide(data(store.sql))),
				),
			);
		}),
	);
	for (const reason of ["storage", "unreachable"] as const) {
		it.effect(`plant, fail at layer build: ${reason} stays a per-call failure`, () =>
			check(fc.jsonValue(), [1], (m) => {
				const {first} = fixture("build-a");
				const failure = new LedgerError({reason});
				const broken = Layer.mergeAll(
					Layer.succeed(Ledger, {
						append: () => Effect.fail(failure),
						read: () => Stream.fail(failure),
						wait: () => Effect.fail(failure),
					}),
					Layer.succeed(LedgerTransaction, {transact: () => Effect.fail(failure)}),
					Layer.succeed(Doorbell, {ring: () => Effect.void}),
				);
				return Effect.gen(function* () {
					const processes = yield* ProcessManager;
					const mailbox = yield* Mailbox;
					expect((yield* Effect.flip(processes.start(first(), from()))).reason).toBe(reason);
					expect(
						(yield* Effect.flip(mailbox.send("counter:1", "letter-a", m, from()))).reason,
					).toBe(reason);
				}).pipe(
					Effect.provide(CoordinationLayer(brain(), ids(A).next).pipe(Layer.provide(broken))),
				);
			}),
		);
	}
});
