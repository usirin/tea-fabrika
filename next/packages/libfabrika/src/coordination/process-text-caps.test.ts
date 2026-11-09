// P33 review round 3, rule 1: every text a client gives that lands in a brain line has a length cap
// in the schema, small enough that no brain line can reach the ledger's per-line limit. The cap is
// the lead's lean, 256 characters, counted as `string.length`, as Schema's max length counts.
import {describe, expect, it} from "@effect/vitest";
import {Effect, Exit, Schema} from "effect";
import * as fc from "fast-check";
import {ProcessManager} from "./process-manager.ts";
import {
	A,
	B,
	brain,
	CODE,
	first,
	from,
	ids,
	manager,
	receive,
	storage,
	type Storage,
	W,
	watcher,
	X,
} from "./process.test-support.ts";
import {Dead, Down, Owner, ProcessFact, Recipient, Start} from "./process.ts";

const CAP = 256;
const at = (length: number, unit = "a") => unit.repeat(length);
const over = at(CAP + 1);
const acceptedText = fc.string({minLength: 1, maxLength: CAP});
const overText = fc.string({minLength: CAP + 1, maxLength: CAP * 4});
const toW = Recipient.cases.process.make({process: W});

const seed = (store: Storage) =>
	Effect.gen(function* () {
		const processes = yield* ProcessManager;
		yield* processes.start(first(), from());
		yield* processes.start(
			first("watcher:start", "watcher:1", {program: "watcher", hash: "build-a"}),
			from(),
		);
	}).pipe(Effect.provide(manager(store, brain(), ids(A, W).next)));
const monitor = (store: Storage, ref: string) =>
	ProcessManager.use((p) => p.monitor(ref, A, from())).pipe(
		Effect.provide(manager(store, watcher(W))),
	);
const exit = (store: Storage, why = "crashed") =>
	ProcessManager.use((p) => p.exit(A, why, from())).pipe(Effect.provide(manager(store)));
const fresh = (store: Storage) => receive(W).pipe(Effect.provide(manager(store, watcher(W))));
const downs = (letters: ReadonlyArray<{readonly m: unknown}>) =>
	letters.flatMap((letter) => {
		const down = Schema.decodeUnknownOption(Down)(letter.m);
		return down._tag === "Some" ? [down.value] : [];
	});
/** A request as a client sends it: raw, never passed through a schema's `make`. */
const raw = (request: object) => request as Start;
/** The call fails with a ProcessError and the ledger holds exactly what it held before. */
const refusedWritingNothing = <A, E>(store: Storage, call: Effect.Effect<A, E>) =>
	Effect.gen(function* () {
		const before = store.rows();
		const answer = yield* Effect.exit(call);
		expect(Exit.isFailure(answer)).toBe(true);
		if (Exit.isFailure(answer))
			expect(JSON.stringify(answer.cause)).toContain('"_tag":"ProcessError"');
		expect(store.rows()).toEqual(before);
	});

describe("P33 rule 1, the text caps live in the schema", () => {
	const code = {program: "counter", hash: "build-a"};
	const cases: ReadonlyArray<{
		readonly name: string;
		readonly schema: Schema.Top;
		readonly value: (text: string) => unknown;
	}> = [
		{
			name: "Start first id",
			schema: Start,
			value: (t) => ({_tag: "first", id: t, name: "n", code}),
		},
		{
			name: "Start first name",
			schema: Start,
			value: (t) => ({_tag: "first", id: "i", name: t, code}),
		},
		{
			name: "Start code program",
			schema: Start,
			value: (t) => ({_tag: "first", id: "i", name: "n", code: {program: t, hash: "h"}}),
		},
		{
			name: "Start code hash",
			schema: Start,
			value: (t) => ({_tag: "first", id: "i", name: "n", code: {program: "p", hash: t}}),
		},
		{
			name: "Start again why",
			schema: Start,
			value: (t) => ({_tag: "again", id: "i", name: "n", code, after: A, why: t}),
		},
		{
			name: "a client id",
			schema: Recipient,
			value: (t) => ({_tag: "client", client: t, session: X}),
		},
		{
			name: "a DOWN's ref",
			schema: Down,
			value: (t) => ({_tag: "DOWN", ref: t, process: A, why: "w", to: toW}),
		},
		{
			name: "a DOWN's why",
			schema: Down,
			value: (t) => ({_tag: "DOWN", ref: "r", process: A, why: t, to: toW}),
		},
		{
			name: "a monitored fact's ref",
			schema: ProcessFact,
			value: (t) => ({_tag: "monitored", ref: t, process: A, to: toW}),
		},
		{
			name: "a demonitored fact's ref",
			schema: ProcessFact,
			value: (t) => ({_tag: "demonitored", ref: t, to: toW, why: "canceled"}),
		},
		{
			name: "an exited fact's why",
			schema: ProcessFact,
			value: (t) => ({_tag: "exited", process: A, why: t}),
		},
		{
			name: "a down fact's why",
			schema: ProcessFact,
			value: (t) => ({_tag: "down", process: A, why: t, crashes: 1, until: 0}),
		},
		{
			name: "a registered fact's name",
			schema: ProcessFact,
			value: (t) => ({_tag: "registered", name: t, program: "p", owner: {_tag: "brain"}}),
		},
		{
			name: "a started fact's name",
			schema: ProcessFact,
			value: (t) => ({_tag: "started", process: A, name: t, program: "p", hash: "h"}),
		},
	];
	for (const {name, schema, value} of cases)
		it(`${name}: ${CAP} characters decode, ${CAP + 1} do not`, () => {
			fc.assert(
				fc.property(acceptedText, overText, (accepted, refused) => {
					expect(Schema.is(schema)(value(accepted))).toBe(true);
					expect(Schema.is(schema)(value(refused))).toBe(false);
				}),
				{seed: 119120, examples: [[at(CAP), over]]},
			);
		});
	// A dead letter keeps one error class per try, so its list is capped too: 32 entries at most.
	const dead = (errors: ReadonlyArray<string>) => ({
		_tag: "dead",
		tries: errors.length,
		limit: errors.length,
		m: "letter-17",
		build: "build-a",
		errors,
	});
	const classes = (count: number) => Array.from({length: count}, () => "TypeError");
	it("a dead letter's errors: 32 entries decode, 33 do not", () => {
		fc.assert(
			fc.property(fc.integer({min: 1, max: 32}), (count) => {
				expect(Schema.is(Dead)(dead(classes(count)))).toBe(true);
				expect(Schema.is(Dead)(dead(classes(count + 32)))).toBe(false);
				// Keep the old 33-entry refusal as well as generated over-cap counts.
				expect(Schema.is(Dead)(dead(classes(33)))).toBe(false);
			}),
			{seed: 119120, examples: [[32]]},
		);
	});
	it(`a dead letter's errors: each entry is capped at ${CAP} characters`, () => {
		fc.assert(
			fc.property(acceptedText, overText, (accepted, refused) => {
				expect(Schema.is(Dead)(dead([...classes(31), accepted]))).toBe(true);
				expect(Schema.is(Dead)(dead([...classes(31), refused]))).toBe(false);
			}),
			{seed: 119120, examples: [[at(CAP), over]]},
		);
	});
	it(`a dead letter's m and build: ${CAP} characters decode, ${CAP + 1} do not`, () => {
		fc.assert(
			fc.property(acceptedText, overText, (accepted, refused) => {
				for (const key of ["m", "build"]) {
					expect(Schema.is(Dead)({...dead(classes(1)), [key]: accepted})).toBe(true);
					expect(Schema.is(Dead)({...dead(classes(1)), [key]: refused})).toBe(false);
				}
			}),
			{seed: 119120, examples: [[at(CAP), over]]},
		);
	});
});

describe("P33 rule 1, an over-cap text is refused as a typed error and writes nothing", () => {
	it(`a monitor with a ${CAP + 1}-character ref`, async () => {
		await fc.assert(
			fc.asyncProperty(overText, (over) => {
				const store = storage();
				return Effect.gen(function* () {
					yield* seed(store);
					yield* refusedWritingNothing(store, monitor(store, over));
				}).pipe(Effect.runPromise);
			}),
			{seed: 119120, numRuns: 20, examples: [[over]]},
		);
	});
	it(`a monitor with a ${CAP}-character ref is accepted`, async () => {
		await fc.assert(
			fc.asyncProperty(acceptedText, (ref) => {
				const store = storage();
				return Effect.gen(function* () {
					yield* seed(store);
					yield* monitor(store, ref);
					yield* exit(store);
					expect(downs(yield* fresh(store)).map((down) => down.ref)).toEqual([ref]);
				}).pipe(Effect.runPromise);
			}),
			{seed: 119120, numRuns: 20, examples: [[at(CAP)]]},
		);
	});
	it(`a monitor for a client whose id has ${CAP + 1} characters`, async () => {
		await fc.assert(
			fc.asyncProperty(overText, (over) => {
				const store = storage();
				return Effect.gen(function* () {
					yield* seed(store);
					const client = {
						owner: Owner.cases.brain.make({}),
						recipient: {_tag: "client", client: over, session: X} as typeof Recipient.Type,
					};
					yield* refusedWritingNothing(
						store,
						ProcessManager.use((p) => p.monitor("watch:1", A, from())).pipe(
							Effect.provide(manager(store, client)),
						),
					);
				}).pipe(Effect.runPromise);
			}),
			{seed: 119120, numRuns: 20, examples: [[over]]},
		);
	});
	it(`an exit whose why has ${CAP + 1} characters`, async () => {
		await fc.assert(
			fc.asyncProperty(overText, (over) => {
				const store = storage();
				return Effect.gen(function* () {
					yield* seed(store);
					yield* monitor(store, "watch:1");
					yield* refusedWritingNothing(store, exit(store, over));
				}).pipe(Effect.runPromise);
			}),
			{seed: 119120, numRuns: 20, examples: [[over]]},
		);
	});
	it(`a down whose why has ${CAP + 1} characters`, async () => {
		await fc.assert(
			fc.asyncProperty(overText, (over) => {
				const store = storage();
				return Effect.gen(function* () {
					yield* seed(store);
					yield* exit(store);
					yield* refusedWritingNothing(
						store,
						ProcessManager.use((p) => p.down(A, {why: over, crashes: 1, until: 0}, from())).pipe(
							Effect.provide(manager(store)),
						),
					);
				}).pipe(Effect.runPromise);
			}),
			{seed: 119120, numRuns: 20, examples: [[over]]},
		);
	});
	const starts: ReadonlyArray<readonly [string, Start]> = [
		["id", raw({_tag: "first", id: over, name: "counter:2", code: CODE})],
		["name", raw({_tag: "first", id: "start:long", name: over, code: CODE})],
		[
			"program",
			raw({_tag: "first", id: "start:long", name: "counter:2", code: {...CODE, program: over}}),
		],
		[
			"hash",
			raw({_tag: "first", id: "start:long", name: "counter:2", code: {...CODE, hash: over}}),
		],
	];
	for (const [field, original] of starts)
		it(`a start whose ${field} has ${CAP + 1} characters`, async () => {
			await fc.assert(
				fc.asyncProperty(overText, (over) => {
					const request = raw(
						field === "program" || field === "hash"
							? {...original, code: {...original.code, [field]: over}}
							: {...original, [field]: over},
					);
					const store = storage();
					return Effect.gen(function* () {
						yield* seed(store);
						yield* refusedWritingNothing(
							store,
							ProcessManager.use((p) => p.start(request, from())).pipe(
								Effect.provide(manager(store, brain(), ids(B).next)),
							),
						);
					}).pipe(Effect.runPromise);
				}),
				{seed: 119120, numRuns: 20, examples: [[over]]},
			);
		});
	it(`a restart whose why has ${CAP + 1} characters`, async () => {
		await fc.assert(
			fc.asyncProperty(overText, (over) => {
				const store = storage();
				return Effect.gen(function* () {
					yield* seed(store);
					yield* exit(store);
					const request = raw({
						_tag: "again",
						id: "restart:long",
						name: "counter:1",
						code: CODE,
						after: A,
						why: over,
					});
					yield* refusedWritingNothing(
						store,
						ProcessManager.use((p) => p.start(request, from())).pipe(
							Effect.provide(manager(store, brain(), ids(B).next)),
						),
					);
				}).pipe(Effect.runPromise);
			}),
			{seed: 119120, numRuns: 20, examples: [[over]]},
		);
	});
});

describe("P33 rule 1, any accepted monitor still gets its DOWN", () => {
	const delivered = (ref: string, why: string) =>
		Effect.gen(function* () {
			const store = storage();
			yield* seed(store);
			yield* monitor(store, ref);
			yield* exit(store, why);
			expect(downs(yield* fresh(store))).toEqual([Down.make({ref, process: A, why, to: toW})]);
		});
	it("the longest ref a monitor accepts still lets the target's exit land", async () => {
		await fc.assert(
			fc.asyncProperty(acceptedText, acceptedText, (ref, why) =>
				Effect.gen(function* () {
					yield* delivered(ref, "crashed");
					yield* delivered(ref, why);
				}).pipe(Effect.runPromise),
			),
			{seed: 119120, numRuns: 20, examples: [[at(CAP), at(CAP, '"')]]},
		);
	});
	it("for any ref: refused over the cap with no write, else the exit lands and DOWN arrives", async () => {
		const ref = fc.oneof(
			fc.string({unit: "grapheme", minLength: 1, maxLength: 40}),
			fc.string({unit: "grapheme-composite", minLength: CAP - 4, maxLength: CAP + 4}),
			fc
				.tuple(
					fc.constantFrom("a", '"', "\\", "é", "\u{1f600}"),
					fc.integer({min: 200, max: 2_100_000}),
				)
				.map(([unit, length]) => unit.repeat(Math.ceil(length / unit.length))),
		);
		await fc.assert(
			fc.asyncProperty(ref, (text) =>
				Effect.runPromise(
					Effect.gen(function* () {
						const store = storage();
						yield* seed(store);
						if (text.length > CAP) {
							yield* refusedWritingNothing(store, monitor(store, text));
							return;
						}
						yield* monitor(store, text);
						yield* exit(store);
						expect(downs(yield* fresh(store))).toEqual([
							Down.make({ref: text, process: A, why: "crashed", to: toW}),
						]);
					}),
				),
			),
			{seed: 119120, numRuns: 25},
		);
	});
});
