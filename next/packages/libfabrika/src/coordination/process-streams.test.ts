// P33 review round 2, one rule instead of single guarded ids: every fact the brain writes about a
// process lives on a stream only the brain may write, and reading an inbox never throws.
import {describe, expect, it} from "@effect/vitest";
import {Effect, Result, Schema} from "effect";
import * as fc from "fast-check";
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
import {Down, ProcessFact, Recipient} from "./process.ts";

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
	it("lifecycle facts are written under processes/, never on the name's own stream", async () => {
		await fc.assert(
			fc.asyncProperty(
				fc
					.stringMatching(/^[a-z][a-z0-9._:-]{0,30}$/)
					.filter(
						(name) =>
							!["processes", "door", "watcher:1"].includes(name) && !name.startsWith("client:"),
					),
				(name) => {
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
						expect(rows.filter((row) => row.stream === name || row.stream === "watcher:1")).toEqual(
							[],
						);
					}).pipe(Effect.runPromise);
				},
			),
			{seed: 119120, numRuns: 20, examples: [["counter:1"]]},
		);
	});
	it("an exit completes and its DOWN arrives whatever a client pre-wrote under the brain's ids", async () => {
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
		await fc.assert(
			fc.asyncProperty(fc.subarray(spots, {minLength: 1}), (planted) =>
				Effect.runPromise(
					Effect.gen(function* () {
						const store = storage();
						yield* seed(store);
						yield* monitor(store);
						for (const {stream, id} of planted)
							expect((yield* plant(store, stream, id, {_tag: "note", n: 1}))._tag).toBe("placed");
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
				),
			),
			{seed: 119120, numRuns: 25},
		);
	});
	it("Mailbox.send refuses any letter whose inbox is under processes/", async () => {
		await fc.assert(
			fc.asyncProperty(
				fc.oneof(
					fc.constant("processes"),
					fc.string({maxLength: 50}).map((tail) => `processes/${tail}`),
				),
				(to) => {
					const store = storage();
					return Effect.gen(function* () {
						const answer = yield* Mailbox.use((mailbox) => mailbox.send(to, "letter:1", 1, from()));
						expect(answer._tag).toBe("refused");
						expect(store.rows()).toEqual([]);
					}).pipe(Effect.provide(manager(store)), Effect.runPromise);
				},
			),
			{
				seed: 119120,
				numRuns: 20,
				examples: [["processes"], ["processes/counter:1"], ["processes/a"]],
			},
		);
	});
});

describe("P33, signal ids belong to the brain alone", () => {
	const space = [
		JSON.stringify(["DOWN", toW, "watch:1"]),
		JSON.stringify(["DOWN", toW, "watch:1", 1]),
		JSON.stringify(["DOWN", "any", "spelling"]),
		JSON.stringify(["DOWN"]),
	];
	it("Mailbox.send refuses signal ids, as the door does", async () => {
		await fc.assert(
			fc.asyncProperty(
				fc
					.array(fc.jsonValue({maxDepth: 2}), {maxLength: 5})
					.map((rest) => JSON.stringify(["DOWN", ...rest])),
				(id) => {
					const store = storage();
					return Effect.gen(function* () {
						yield* seed(store);
						const before = store.rows();
						const m = Down.make({ref: "watch:1", process: A, why: "crashed", to: toW});
						const answer = yield* Mailbox.use((mailbox) =>
							mailbox.send("watcher:1", id, m, from()),
						);
						expect(answer._tag).toBe("refused");
						expect(store.rows()).toEqual(before);
						// The same letter under an ordinary id lands: the id alone was refused.
						const plain = yield* Mailbox.use((mailbox) =>
							mailbox.send("watcher:1", "letter:1", m, from()),
						);
						expect(plain._tag).toBe("placed");
					}).pipe(Effect.provide(manager(store)), Effect.runPromise);
				},
			),
			{seed: 119120, numRuns: 20, examples: space.map((id): [string] => [id])},
		);
	});
	it("a row at the signal id counts as the signal only when the brain's key wrote it", async () => {
		await fc.assert(
			fc.asyncProperty(fc.string({minLength: 1, maxLength: 40}), (ref) =>
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
					if (Result.isSuccess(exited))
						expect(owed).toEqual([Down.make({ref, process: A, why: "crashed", to: toW})]);
					else
						expect(
							yield* ProcessManager.use((p) => p.isLive(A)).pipe(Effect.provide(manager(store))),
						).toBe(true);
				}).pipe(Effect.runPromise),
			),
			{seed: 119120, numRuns: 20, examples: [["watch:1"]]},
		);
	});
	it("signal ids carry the watch's round: a watch renewed after a cancel gets a fresh DOWN", async () => {
		await fc.assert(
			fc.asyncProperty(fc.string({minLength: 1, maxLength: 40}), (ref) => {
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
				}).pipe(Effect.runPromise);
			}),
			{seed: 119120, numRuns: 20, examples: [["watch:1"]]},
		);
	});
});

describe("P33, an inbox read is total", () => {
	// Pinned: a `send` whose body has no `m` is skipped; any `m`, whatever its shape, is plain mail.
	const junk = fc.oneof(
		fc.jsonValue({maxDepth: 1}),
		fc.dictionary(fc.constantFrom("m", "n", "_tag", "ref", "to"), fc.jsonValue({maxDepth: 2}), {
			maxKeys: 4,
		}),
		fc.record({m: fc.record({_tag: fc.constant("DOWN"), ref: fc.jsonValue({maxDepth: 1})})}),
	);
	const hasM = (body: unknown): body is {readonly m: unknown} =>
		typeof body === "object" && body !== null && !Array.isArray(body) && Object.hasOwn(body, "m");
	it("junk send bodies never fail a receive, and later receives on that inbox still work", async () => {
		await fc.assert(
			fc.asyncProperty(fc.array(junk, {minLength: 1, maxLength: 8}), (bodies) =>
				Effect.runPromise(
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
							if (placed._tag === "placed" && hasM(body)) want.push(JSON.stringify(body.m));
						}
						const letters = yield* fresh(store);
						expect(letters.map((letter) => JSON.stringify(letter.m))).toEqual(want);
						const last = store.rows().at(-1)!.rev;
						yield* Mailbox.use((mailbox) =>
							mailbox.send("watcher:1", "later", {hello: 1}, from()),
						).pipe(Effect.provide(manager(store)));
						expect((yield* fresh(store, last)).map((letter) => letter.id)).toEqual(["later"]);
					}),
				),
			),
			{seed: 119120, numRuns: 40},
		);
	});
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
	it("start, exit, monitor and demonitor keep the caller's own key as asked", async () => {
		await fc.assert(
			fc.asyncProperty(
				fc.string({minLength: 1, maxLength: 40}),
				fc.string({minLength: 1, maxLength: 40}),
				(clientKey, watcherKey) => {
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
					}).pipe(Effect.runPromise);
				},
			),
			{seed: 119120, numRuns: 20, examples: [[CLIENT, "SHA256:watcher-key"]]},
		);
	});
	it("asked is kept out of the trust check: another writer's line naming the brain counts for nothing", async () => {
		await fc.assert(
			fc.asyncProperty(
				fc
					.stringMatching(/^[a-z][a-z0-9._:-]{0,30}$/)
					.filter((name) => !["door", "processes"].includes(name) && !name.startsWith("client:")),
				(name) => {
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
						if (Result.isSuccess(started)) expect(started.success.process).toBe(A);
					}).pipe(Effect.runPromise);
				},
			),
			{seed: 119120, numRuns: 20, examples: [["counter:1"]]},
		);
	});
});

describe("P33, a process name never meets a door stream", () => {
	it("a process named door is refused as bad_name and writes nothing", async () => {
		await fc.assert(
			fc.asyncProperty(fc.constantFrom("door", "processes"), (name) => {
				const store = storage();
				return Effect.gen(function* () {
					const answer = yield* Effect.result(
						ProcessManager.use((p) => p.start(first("start:door", name), from())),
					);
					expect(Result.isFailure(answer)).toBe(true);
					if (Result.isFailure(answer)) expect(answer.failure.why).toBe("bad_name");
					expect(store.rows()).toEqual([]);
				}).pipe(Effect.provide(manager(store, brain(), ids(X).next)), Effect.runPromise);
			}),
			{seed: 119120, numRuns: 20, examples: [["door"]]},
		);
	});
});
