// P33 review round 2, one rule instead of single guarded ids: every fact the brain writes about a
// process lives on a stream only the brain may write, and reading an inbox never throws.
import {describe, expect, it} from "@effect/vitest";
import {Arbitrary, Effect, Result, Schema} from "effect";
import {Ledger} from "../data/ledger.ts";
import {type Entry, lineFor} from "../data/log.ts";
import {Mailbox} from "./mailbox.ts";
import {ProcessManager} from "./process-manager.ts";
import {
	A,
	B,
	BRAIN,
	brain,
	CLIENT,
	again,
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
import {brainOnly, Down, ProcessFact, Recipient, Start} from "./process.ts";

// Match fc.jsonValue({maxDepth: depth}): finite numbers, strings/keys of
// length 0..10, and arrays/objects of width 0..10. No required object keys.
// Finite schema levels give every child its own full range. Call with size >= 10.
const scalar = Schema.Union([
	Schema.Null,
	Schema.Boolean,
	Schema.Finite,
	Schema.String.check(Schema.isMaxLength(10)),
]);

const json = (depth: number): Schema.Codec<Schema.Json> =>
	depth === 0
		? scalar
		: Schema.Union([
				scalar,
				Schema.Array(json(depth - 1)).check(Schema.isMaxLength(10)),
				Schema.Record(Schema.String.check(Schema.isMaxLength(10)), json(depth - 1)).check(
					Schema.isMaxProperties(10),
				),
			]);

const examples =
	<A extends ReadonlyArray<unknown>, E, R>(
		cases: ReadonlyArray<A>,
		law: (...args: A) => Effect.Effect<unknown, E, R>,
	) =>
	(args: A) =>
		Effect.forEach([...cases, args], (input) => Effect.suspend(() => law(...input)), {
			discard: true,
			concurrency: 1,
		});

const nameInput = Start.cases.first.fields.name.check(
	Schema.isPattern(/^[a-z][a-z0-9._:-]{0,30}$/),
);

const validName = Arbitrary.schema(nameInput).pipe(
	Arbitrary.filter((name) => !["door", "processes"].includes(name) && !name.startsWith("client:")),
);

const textInput = Schema.NonEmptyString.check(Schema.isMaxLength(40));
// Cover complete names 1..31, processes/ plus 0..50 characters, refs and
// caller keys 1..40. Fixed-depth JSON below keeps width/string length 10.
const options = {arbitrary: {seed: 119120, runs: 20, size: 60}};

const POLICY = {why: "crashed", crashes: 1, until: 0};
const toW = Recipient.cases.process.make({process: W});
const brainSide = (process: string) => process === "processes" || process.startsWith("processes/");

const seed = (store: Storage, name = "counter:1") =>
	Effect.gen(function* () {
		const processes = yield* ProcessManager;
		yield* processes.start(first("start:counter:1", name), from());
		yield* processes.start(
			first("watcher:start", "watcher:1", {program: "watcher", hash: "build-a"}),
			from(),
		);
	}).pipe(Effect.provide(manager(store, brain(), ids(A, W).next)));

const monitor = (store: Storage, ref = "watch:1", target = A, by = BRAIN) =>
	ProcessManager.use((p) => p.monitor(ref, target, from({by}))).pipe(
		Effect.provide(manager(store, watcher(W))),
	);

const cancel = (store: Storage, ref = "watch:1", by = BRAIN) =>
	ProcessManager.use((p) => p.demonitor(ref, from({by}))).pipe(
		Effect.provide(manager(store, watcher(W))),
	);

const exit = (store: Storage, process = A, by = BRAIN) =>
	ProcessManager.use((p) => p.exit(process, "crashed", from({by}))).pipe(
		Effect.provide(manager(store)),
	);

const fresh = (store: Storage, after = 0) =>
	receive(W, after).pipe(Effect.provide(manager(store, watcher(W))));

/** Another writer's raw row: what a client could hold on a stream it may write. */
const plant = (
	store: Storage,
	stream: string,
	id: string,
	fact: {readonly _tag: string} & Schema.JsonObject,
) =>
	Ledger.use((ledger) => ledger.append(stream, id, lineFor(from({by: CLIENT}), fact))).pipe(
		Effect.provide(manager(store)),
	);

const downs = (letters: ReadonlyArray<{readonly m: unknown; readonly by: string}>) =>
	letters.flatMap((letter) => {
		const down = Schema.decodeUnknownOption(Down)(letter.m);
		return letter.by === BRAIN && down._tag === "Some" ? [down.value] : [];
	});

describe("P33, every process fact lives on a stream only the brain may write", () => {
	it.effect.prop(
		"lifecycle facts are written under processes/, never on the name's own stream",
		[
			Arbitrary.schema(nameInput).pipe(
				Arbitrary.filter(
					(name) =>
						!["processes", "door", "watcher:1"].includes(name) && !name.startsWith("client:"),
				),
			),
		],
		examples([["counter:1"]], (name: string) => {
			const store = storage();
			return Effect.gen(function* () {
				yield* seed(store, name);
				yield* monitor(store);
				yield* cancel(store);
				yield* monitor(store, "watch:2");
				yield* exit(store);
				yield* ProcessManager.use((p) =>
					Effect.gen(function* () {
						yield* p.down(A, POLICY, from());
						yield* p.start({...again(A), name}, from());
					}),
				).pipe(Effect.provide(manager(store, brain(), ids(B).next)));
				const rows = store.rows();
				const facts = rows.filter((row) => Object.hasOwn(ProcessFact.cases, row._tag));
				expect(new Set(facts.map((row) => row._tag))).toEqual(
					new Set(Object.keys(ProcessFact.cases)),
				);
				expect(facts.filter((row) => !brainSide(row.stream))).toEqual([]);
				// The start request's own id is a lifecycle line too.
				expect(rows.find((row) => row.id === "start:counter:1")?.stream).toSatisfy(brainSide);
				expect(rows.filter((row) => row.stream === name || row.stream === "watcher:1")).toEqual([]);
			});
		}),
		options,
	);
	{
		const pid = (...parts: ReadonlyArray<unknown>) => JSON.stringify(parts);
		const brainIds = [pid("exited", A), pid("down", A, POLICY), pid("restarted", B)];
		const writable = [
			"counter:1",
			"counter:1/inbox",
			"watcher:1",
			"watcher:1/inbox",
			"client:window-a/inbox",
			"notes",
		];
		const spots = writable.flatMap((stream) => brainIds.map((id) => ({stream, id})));
		// Boolean selection keeps every nonempty subset without replacement, like the old subarray.
		const planted = Arbitrary.schema(
			Schema.Array(Schema.Boolean).check(
				Schema.isMinLength(spots.length),
				Schema.isMaxLength(spots.length),
			),
		).pipe(
			Arbitrary.map((chosen) => spots.filter((_, n) => chosen[n])),
			Arbitrary.filter((chosen) => chosen.length > 0),
		);
		it.effect.prop(
			"an exit completes and its DOWN arrives whatever a client pre-wrote under the brain's ids",
			[planted],
			([planted]) =>
				Effect.gen(function* () {
					const store = storage();
					yield* seed(store);
					yield* monitor(store);

					for (const {stream, id} of planted) {
						expect((yield* plant(store, stream, id, {_tag: "note", n: 1}))._tag).toBe("placed");
					}

					yield* exit(store);
					expect(downs(yield* fresh(store))).toEqual([
						Down.make({ref: "watch:1", process: A, why: "crashed", to: toW}),
					]);
					const next = yield* ProcessManager.use((p) =>
						Effect.gen(function* () {
							yield* p.down(A, POLICY, from());
							return yield* p.start(again(A), from());
						}),
					).pipe(Effect.provide(manager(store, brain(), ids(B).next)));
					expect(next.process).toBe(B);
				}),
			{arbitrary: {seed: 119120, runs: 25}},
		);
	}
	it.effect.prop(
		"Mailbox.send refuses any letter whose inbox is under processes/",
		[Schema.String.check(Schema.isPattern(/^processes(?:\/[\s\S]{0,50})?$/))],
		examples([["processes"], ["processes/counter:1"], ["processes/a"]], (to: string) => {
			const store = storage();
			return Effect.gen(function* () {
				const answer = yield* Mailbox.use((mailbox) => mailbox.send(to, "letter:1", 1, from()));
				expect(answer._tag).toBe("refused");
				expect(store.rows()).toEqual([]);
			}).pipe(Effect.provide(manager(store)));
		}),
		options,
	);
	it.prop(
		"the bare processes stream reserves ordinary non-fact writes",
		[Schema.String, Schema.String],
		([id, tag]) => {
			expect(brainOnly({stream: "processes", id, tag})).toBe(true);
		},
		{arbitrary: {seed: 119120, runs: 100}},
	);
	it.effect.prop(
		"a refused start writes nothing and consumes no new process id",
		[validName],
		([tail]) => {
			const store = storage();
			const next = ids(A, B);
			return Effect.gen(function* () {
				const processes = yield* ProcessManager;
				yield* processes.start(first("first", tail), from());
				const before = store.rows();
				const answer = yield* Effect.result(processes.start(first("different", tail), from()));
				expect(Result.isFailure(answer)).toBe(true);

				if (Result.isFailure(answer)) {
					expect(answer.failure.why).toBe("name_taken");
				}

				expect(store.rows()).toEqual(before);
				expect(next.calls()).toBe(1);
			}).pipe(Effect.provide(manager(store, brain(), next.next)));
		},
		options,
	);
	it.effect.prop(
		"a start losing a name race refuses before writing its own lifecycle",
		[validName],
		([name]) => {
			const store = storage();
			let winner: ReadonlyArray<Entry> = [];
			const next = Effect.gen(function* () {
				yield* ProcessManager.use((p) => p.start(first("winner", name), from())).pipe(
					Effect.provide(manager(store, brain(), ids(A).next)),
				);
				winner = store.rows();
				return B;
			}).pipe(Effect.orDie);
			return Effect.gen(function* () {
				const answer = yield* ProcessManager.use((p) =>
					Effect.result(p.start(first("loser", name), from())),
				);
				expect(Result.isFailure(answer)).toBe(true);

				if (Result.isFailure(answer)) {
					expect(answer.failure.why).toBe("name_taken");
				}

				expect(store.rows()).toEqual(winner);
			}).pipe(Effect.provide(manager(store, brain(), next)));
		},
		options,
	);
});

describe("P33, signal ids belong to the brain alone", () => {
	const space = [
		JSON.stringify(["DOWN", toW, "watch:1"]),
		JSON.stringify(["DOWN", toW, "watch:1", 1]),
		JSON.stringify(["DOWN", "any", "spelling"]),
		JSON.stringify(["DOWN"]),
	];
	it.effect.prop(
		"Mailbox.send refuses signal ids, as the door does",
		[
			Arbitrary.schema(Schema.Array(json(2)).check(Schema.isMaxLength(5))).pipe(
				Arbitrary.map((rest) => JSON.stringify(["DOWN", ...rest])),
			),
		],
		examples(
			space.map((id): [string] => [id]),
			(id: string) => {
				const store = storage();
				return Effect.gen(function* () {
					yield* seed(store);
					const before = store.rows();
					const m = Down.make({ref: "watch:1", process: A, why: "crashed", to: toW});
					const answer = yield* Mailbox.use((mailbox) => mailbox.send("watcher:1", id, m, from()));
					expect(answer._tag).toBe("refused");
					expect(store.rows()).toEqual(before);
					// The same letter under an ordinary id lands: the id alone was refused.
					const plain = yield* Mailbox.use((mailbox) =>
						mailbox.send("watcher:1", "letter:1", m, from()),
					);
					expect(plain._tag).toBe("placed");
				}).pipe(Effect.provide(manager(store)));
			},
		),
		options,
	);
	it.effect.prop(
		"a row at the signal id counts as the signal only when the brain's key wrote it",
		[Down.fields.ref.check(Schema.isMaxLength(40))],
		examples([["watch:1"]], (ref: string) =>
			Effect.gen(function* () {
				// The brain's own signal id for this watch, read from a clean run.
				const clean = storage();
				yield* seed(clean);
				yield* monitor(clean, ref);
				yield* exit(clean);
				const signal = clean.rows().find((row) => row.stream === "watcher:1/inbox")!;
				expect(signal.by).toBe(BRAIN);
				// Another writer holds that id first. The exit may refuse, but never ends silently.
				const store = storage();
				yield* seed(store);
				yield* monitor(store, ref);
				yield* plant(store, "watcher:1/inbox", signal.id, {_tag: "send", m: "taken"});
				const exited = yield* Effect.result(exit(store));
				const owed = downs(yield* fresh(store));

				if (Result.isSuccess(exited)) {
					expect(owed).toEqual([Down.make({ref, process: A, why: "crashed", to: toW})]);
				} else {
					expect(
						yield* ProcessManager.use((p) => p.isLive(A)).pipe(Effect.provide(manager(store))),
					).toBe(true);
				}
			}),
		),
		options,
	);
	it.effect.prop(
		"signal ids carry the watch's round: a watch renewed after a cancel gets a fresh DOWN",
		[Down.fields.ref.check(Schema.isMaxLength(40))],
		examples([["watch:1"]], (ref: string) => {
			const store = storage();
			return Effect.gen(function* () {
				yield* seed(store);
				yield* monitor(store, ref);
				yield* exit(store);
				yield* cancel(store, ref);
				expect(downs(yield* fresh(store))).toEqual([]);
				yield* monitor(store, ref);
				expect(downs(yield* fresh(store))).toEqual([
					Down.make({ref, process: A, why: "noproc", to: toW}),
				]);
				const inbox = store.rows().filter((row) => row.stream === "watcher:1/inbox");
				expect(new Set(inbox.map((row) => row.id)).size).toBe(2);
			});
		}),
		options,
	);
});

describe("P33, an inbox read is total", () => {
	// Pinned: a `send` whose body has no `m` is skipped; any `m`, whatever its shape, is plain mail.
	const junk = Schema.Union([
		json(1),
		// Optional keys keep every subset, from 0 to 5 keys, with nested JSON in every value.
		Schema.Struct({
			m: Schema.optionalKey(json(2)),
			n: Schema.optionalKey(json(2)),
			_tag: Schema.optionalKey(json(2)),
			ref: Schema.optionalKey(json(2)),
			to: Schema.optionalKey(json(2)),
		}),
		Schema.Struct({m: Schema.Struct({_tag: Schema.Literal("DOWN"), ref: json(1)})}),
	]);
	const hasM = (body: unknown): body is {readonly m: unknown} =>
		typeof body === "object" && body !== null && !Array.isArray(body) && Object.hasOwn(body, "m");
	// Plant: drop nested mail in envelopes with 2 to 4 keys. Shrinks to {ref: 0, m: []}.
	it.effect.prop(
		"junk send bodies never fail a receive, and later receives on that inbox still work",
		[Schema.Array(junk).check(Schema.isMinLength(1), Schema.isMaxLength(8))],
		([bodies]) =>
			Effect.gen(function* () {
				const store = storage();
				yield* seed(store);
				const want: Array<string> = [];

				for (const [n, body] of bodies.entries()) {
					const placed = yield* Ledger.use((ledger) =>
						ledger.append("watcher:1/inbox", `junk:${n}`, {
							...from({by: CLIENT}),
							_tag: "send",
							body: body as Schema.Json,
						}),
					).pipe(Effect.provide(manager(store)));

					if (placed._tag === "placed" && hasM(body)) {
						want.push(JSON.stringify(body.m));
					}
				}

				const letters = yield* fresh(store);
				expect(letters.map((letter) => JSON.stringify(letter.m))).toEqual(want);
				const last = store.rows().at(-1)!.rev;
				yield* Mailbox.use((mailbox) =>
					mailbox.send("watcher:1", "later", {hello: 1}, from()),
				).pipe(Effect.provide(manager(store)));
				expect((yield* fresh(store, last)).map((letter) => letter.id)).toEqual(["later"]);
			}),
		{arbitrary: {seed: 119120, runs: 40, size: 110}},
	);
});

describe("P33, every brain-written line records who asked", () => {
	const added = (store: Storage, before: ReadonlyArray<Entry>) =>
		store.rows().filter((row) => !before.some((old) => old.rev === row.rev));
	const asks = (rows: ReadonlyArray<Entry>, key: string) => {
		expect(rows.length).toBeGreaterThan(0);

		for (const row of rows) {
			expect(row.by).toBe(BRAIN);
			expect((row.body as {readonly asked?: unknown}).asked).toBe(key);
		}
	};
	it.effect.prop(
		"start, exit, monitor and demonitor keep the caller's own key as asked",
		[textInput, textInput],
		examples([[CLIENT, "SHA256:watcher-key"]], (clientKey: string, watcherKey: string) => {
			const store = storage();
			return Effect.gen(function* () {
				let before = store.rows();
				yield* ProcessManager.use((p) => p.start(first(), from({by: clientKey}))).pipe(
					Effect.provide(manager(store, brain(), ids(A).next)),
				);
				asks(added(store, before), clientKey);
				yield* ProcessManager.use((p) =>
					p.start(
						first("watcher:start", "watcher:1", {program: "watcher", hash: "build-a"}),
						from(),
					),
				).pipe(Effect.provide(manager(store, brain(), ids(W).next)));
				before = store.rows();
				yield* monitor(store, "watch:1", A, watcherKey);
				asks(added(store, before), watcherKey);
				before = store.rows();
				yield* cancel(store, "watch:1", watcherKey);
				asks(added(store, before), watcherKey);
				yield* monitor(store, "watch:2", A, watcherKey);
				before = store.rows();
				yield* exit(store, A, clientKey);
				const exited = added(store, before);
				expect(exited.map((row) => row._tag).sort()).toEqual(["exited", "send"]);
				asks(exited, clientKey);
			});
		}),
		options,
	);
	it.effect.prop(
		"asked is kept out of the trust check: another writer's line naming the brain counts for nothing",
		[
			Arbitrary.schema(nameInput).pipe(
				Arbitrary.filter(
					(name) => !["door", "processes"].includes(name) && !name.startsWith("client:"),
				),
			),
		],
		examples([["counter:1"]], (name: string) => {
			const store = storage();
			return Effect.gen(function* () {
				yield* plant(store, "processes", "forged:registered", {
					_tag: "registered",
					name,
					program: "counter",
					owner: {_tag: "brain"},
					asked: BRAIN,
				});
				const started = yield* Effect.result(
					ProcessManager.use((p) => p.start(first("start:counter:1", name), from())).pipe(
						Effect.provide(manager(store, brain(), ids(A).next)),
					),
				);
				expect(Result.isSuccess(started)).toBe(true);

				if (Result.isSuccess(started)) {
					expect(started.success.process).toBe(A);
				}
			});
		}),
		options,
	);
});

describe("P33, a process name never meets a door stream", () => {
	it.effect.prop(
		"a process named door is refused as bad_name and writes nothing",
		[Schema.Literals(["door", "processes"])],
		examples([["door"]], (name: string) => {
			const store = storage();
			return Effect.gen(function* () {
				const answer = yield* Effect.result(
					ProcessManager.use((p) => p.start(first("start:door", name), from())),
				);
				expect(Result.isFailure(answer)).toBe(true);

				if (Result.isFailure(answer)) {
					expect(answer.failure.why).toBe("bad_name");
				}

				expect(store.rows()).toEqual([]);
			}).pipe(Effect.provide(manager(store, brain(), ids(X).next)));
		}),
		options,
	);
});
