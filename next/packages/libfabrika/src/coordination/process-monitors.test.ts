// p79's OTP monitor rules, P33. Stored mail is read independently of fresh delivery.
import {describe, expect, it} from "@effect/vitest";
import {Effect, Layer, Schema} from "effect";
import {Doorbell, Ledger} from "../data/ledger.ts";
import {Mailbox} from "./mailbox.ts";
import {ProcessManager} from "./process-manager.ts";
import {
	A,
	B,
	W,
	X,
	again,
	brain,
	first,
	from,
	ids,
	manager,
	receive,
	storage,
	type Storage,
	watcher,
} from "./process.test-support.ts";
import {Down, Recipient, Start} from "./process.ts";

const signals = (store: Storage) =>
	store
		.rows()
		.filter((row) => row._tag === "send")
		.map((row) => ({
			id: row.id,
			stream: row.stream,
			rev: row.rev,
			m: Schema.decodeUnknownSync(Schema.Struct({m: Down}))(row.body).m,
		}));
const seed = (store: Storage) =>
	Effect.gen(function* () {
		const processes = yield* ProcessManager;
		yield* processes.start(first(), from());
		yield* processes.start(
			first("watcher:start", "watcher:1", {program: "watcher", hash: "build-a"}),
			from(),
		);
		yield* processes.start(
			first("observer:start", "observer:1", {program: "observer", hash: "build-a"}),
			from(),
		);
	}).pipe(Effect.provide(manager(store, brain(), ids(A, W, X).next)));
const monitor = (store: Storage, ref: string, target = A, to = W) =>
	ProcessManager.use((p) => p.monitor(ref, target, from())).pipe(
		Effect.provide(manager(store, watcher(to))),
	);
const exit = (store: Storage, process = A) =>
	ProcessManager.use((p) => p.exit(process, "crashed", from())).pipe(
		Effect.provide(manager(store)),
	);
const cancel = (store: Storage, ref: string, to = W) =>
	ProcessManager.use((p) => p.demonitor(ref, from())).pipe(
		Effect.provide(manager(store, watcher(to))),
	);
const fresh = (store: Storage, process = W, after = 0) =>
	receive(process, after).pipe(Effect.provide(manager(store, watcher(process))));

describe("p79, addressed and independent monitors", () => {
	it.effect(
		"plant, omit to or collapse monitors: each reference gets one stable addressed DOWN",
		() => {
			const store = storage();
			return Effect.gen(function* () {
				yield* seed(store);
				yield* monitor(store, "watch:1");
				yield* monitor(store, "watch:1");
				yield* monitor(store, "watch:2");
				yield* monitor(store, "other:1", A, X);
				store.reopen();
				yield* exit(store);
				yield* exit(store);
				yield* monitor(store, "watch:1");
				const mail = signals(store);
				expect(mail).toHaveLength(3);
				expect(new Set(mail.map((row) => row.id)).size).toBe(3);
				expect(mail.map((row) => row.m).sort((a, b) => a.ref.localeCompare(b.ref))).toEqual([
					Down.make({
						ref: "other:1",
						process: A,
						why: "crashed",
						to: Recipient.cases.process.make({process: X}),
					}),
					Down.make({
						ref: "watch:1",
						process: A,
						why: "crashed",
						to: Recipient.cases.process.make({process: W}),
					}),
					Down.make({
						ref: "watch:2",
						process: A,
						why: "crashed",
						to: Recipient.cases.process.make({process: W}),
					}),
				]);
				expect((yield* fresh(store)).map((letter) => letter.id).sort()).toEqual(
					mail
						.filter((row) => row.m.to._tag === "process" && row.m.to.process === W)
						.map((row) => row.id)
						.sort(),
				);
			});
		},
	);
	it.effect(
		"plant, accept another recipient's reference: a ref cannot be stolen or retargeted",
		() => {
			const store = storage();
			return Effect.gen(function* () {
				yield* seed(store);
				yield* monitor(store, "watch:1");
				const before = store.rows();
				expect((yield* Effect.flip(monitor(store, "watch:1", W))).why).toBe("bad_ref");
				// Watches are keyed by (recipient, ref): X has no watch:1, so its cancel is a no-op.
				yield* cancel(store, "watch:1", X);
				expect(store.rows()).toEqual(before);
				yield* exit(store);
				expect(signals(store)[0]?.m.process).toBe(A);
			});
		},
	);
	for (const ended of [false, true]) {
		it.effect(
			`plant, wait forever: monitoring an ${ended ? "ended" : "absent"} ID queues noproc before returning`,
			() => {
				const store = storage();
				return Effect.gen(function* () {
					yield* seed(store);
					if (ended) yield* exit(store);
					const target = ended ? A : B;
					yield* monitor(store, "missing", target);
					expect(signals(store)).toHaveLength(1);
					expect(signals(store)[0]?.m).toEqual(
						Down.make({
							ref: "missing",
							process: target,
							why: "noproc",
							to: Recipient.cases.process.make({process: W}),
						}),
					);
					const saved = signals(store);
					store.reopen();
					yield* monitor(store, "missing", target);
					expect(signals(store)).toEqual(saved);
					expect(yield* fresh(store)).toHaveLength(1);
				});
			},
		);
	}
	it.effect(
		"plant, address only a client name: a window monitor records the exact connection session",
		() => {
			const store = storage();
			const caller = brain();
			return Effect.gen(function* () {
				yield* seed(store);
				yield* ProcessManager.use((p) => p.monitor("window:1", A, from())).pipe(
					Effect.provide(manager(store, caller)),
				);
				yield* exit(store);
				expect(signals(store)[0]?.m.to).toEqual(caller.recipient);
			});
		},
	);
	it.effect(
		"plant, retain a dead watcher's monitors: ending it removes its outbound watches",
		() => {
			const store = storage();
			return Effect.gen(function* () {
				yield* seed(store);
				yield* monitor(store, "watch:1");
				yield* exit(store, W);
				store.reopen();
				yield* exit(store);
				expect(signals(store)).toEqual([]);
			});
		},
	);
});

describe("p79, atomic exit", () => {
	for (const after of [1, 2]) {
		it.effect(
			`plant, separate appends or early rings: failure after ${after} writes rolls back exit and all owed signals`,
			() => {
				const store = storage();
				const rings: Array<string> = [];
				const bell = Layer.succeed(Doorbell, {
					ring: (_to, stream) =>
						Effect.sync(() => {
							rings.push(stream);
						}),
				});
				return Effect.gen(function* () {
					yield* seed(store);
					yield* monitor(store, "one");
					yield* monitor(store, "two", A, X);
					yield* Ledger.use((ledger) =>
						Effect.all([ledger.wait("watcher:1/inbox", 0), ledger.wait("observer:1/inbox", 0)], {
							concurrency: 1,
						}),
					).pipe(Effect.provide(manager(store, brain(), ids().next, bell)));
					const before = store.rows();
					const passed = store.fault.writes;
					store.fault.after = after;
					expect(
						(yield* Effect.flip(
							ProcessManager.use((p) => p.exit(A, "crashed", from())).pipe(
								Effect.provide(manager(store, brain(), ids().next, bell)),
							),
						)).why,
					).toBe("storage");
					expect(store.fault.writes - passed).toBe(after);
					expect(store.rows()).toEqual(before);
					expect(rings).toEqual([]);
					store.fault.after = null;
					store.reopen();
					expect(
						yield* ProcessManager.use((p) => p.isLive(A)).pipe(Effect.provide(manager(store))),
					).toBe(true);
					yield* ProcessManager.use((p) => p.exit(A, "crashed", from())).pipe(
						Effect.provide(manager(store, brain(), ids().next, bell)),
					);
					expect(signals(store)).toHaveLength(2);
					expect(rings.sort()).toEqual(["observer:1/inbox", "watcher:1/inbox"]);
					expect(yield* fresh(store)).toHaveLength(1);
					expect(yield* fresh(store, X)).toHaveLength(1);
				});
			},
		);
	}
});

describe("p79, cancellation, replay and stale delivery", () => {
	for (const queued of [false, true]) {
		it.effect(
			`plant, remove only the watch row: cancel ${queued ? "after enqueue" : "before exit"} survives reopen`,
			() => {
				const store = storage();
				return Effect.gen(function* () {
					yield* seed(store);
					yield* monitor(store, "canceled");
					yield* monitor(store, "kept");
					if (queued) yield* exit(store);
					yield* cancel(store, "canceled");
					yield* cancel(store, "canceled");
					store.reopen();
					if (!queued) yield* exit(store);
					const delivered = yield* fresh(store);
					expect(delivered.map((letter) => Schema.decodeUnknownSync(Down)(letter.m).ref)).toEqual([
						"kept",
					]);
					expect(
						signals(store)
							.map((row) => row.m.ref)
							.sort(),
					).toEqual(queued ? ["canceled", "kept"] : ["kept"]);
					expect(
						store.rows().filter((row) => row._tag === "demonitored").length,
					).toBeGreaterThanOrEqual(1);
				});
			},
		);
	}
	it.effect("plant, resolve a name at delivery: an old DOWN never retargets a replacement", () => {
		const store = storage();
		return Effect.gen(function* () {
			yield* seed(store);
			yield* monitor(store, "old-target");
			yield* exit(store);
			yield* ProcessManager.use((p) => p.start(again(A), from())).pipe(
				Effect.provide(manager(store, brain(), ids(B).next)),
			);
			yield* monitor(store, "new-target", B);
			store.reopen();
			const old = yield* fresh(store);
			expect(old).toHaveLength(1);
			expect(Schema.decodeUnknownSync(Down)(old[0]!.m).process).toBe(A);
			yield* exit(store, B);
			const later = yield* fresh(store, W, old[0]!.rev);
			expect(later.map((letter) => Schema.decodeUnknownSync(Down)(letter.m).process)).toEqual([B]);
		});
	});
	it.effect(
		"plant, reuse a watcher's inbox: a new watcher life cannot receive an old signal",
		() => {
			const store = storage();
			return Effect.gen(function* () {
				yield* seed(store);
				yield* monitor(store, "same-ref");
				yield* exit(store);
				const old = signals(store)[0]!;
				yield* exit(store, W);
				yield* ProcessManager.use((p) =>
					p.start(
						Start.cases.again.make({
							id: "watcher:restart",
							after: W,
							why: "crashed",
							name: "watcher:1",
							code: {program: "watcher", hash: "build-a"},
						}),
						from(),
					),
				).pipe(Effect.provide(manager(store, brain(), ids(B).next)));
				store.reopen();
				expect(yield* fresh(store, B)).toEqual([]);
				yield* monitor(store, "new-life-ref", A, B);
				yield* Mailbox.use((mailbox) =>
					mailbox.send("watcher:1", "delayed-old", old.m, from()),
				).pipe(Effect.provide(manager(store)));
				// The delayed copy's id is not its signal id, so it is plain mail, never B's signal.
				const later = yield* fresh(store, B);
				const owed = later.filter((letter) => letter.id !== "delayed-old");
				expect(owed).toHaveLength(1);
				expect(owed[0]!.id).not.toBe(old.id);
				expect(Schema.decodeUnknownSync(Down)(owed[0]!.m).to).toEqual(
					Recipient.cases.process.make({process: B}),
				);
			});
		},
	);
});

// P33 review rules. A DOWN is a signal only under its own id, with a watch of that recipient,
// ref and target, live or canceled. Anything else is plain mail. Watches key on (recipient, ref).
const toW = Recipient.cases.process.make({process: W});
const send = (store: Storage, id: string, m: unknown) =>
	Mailbox.use((mailbox) => mailbox.send("watcher:1", id, m, from())).pipe(
		Effect.provide(manager(store)),
	);
const demonitored = (store: Storage) =>
	store
		.rows()
		.filter((row) => row._tag === "demonitored")
		.map((row) => row.body as {readonly ref: string; readonly why?: unknown});

describe("P33, a DOWN is a signal only under its signal id and a matching watch", () => {
	it.effect("a DOWN-tagged letter under any other id is plain mail: cancel never drops it", () => {
		const store = storage();
		return Effect.gen(function* () {
			yield* seed(store);
			yield* monitor(store, "watch:1");
			yield* cancel(store, "watch:1");
			yield* send(
				store,
				"forged",
				Down.make({ref: "watch:1", process: A, why: "crashed", to: toW}),
			);
			expect((yield* fresh(store)).map((letter) => letter.id)).toEqual(["forged"]);
		});
	});
	it.effect(
		"a DOWN under its signal id with no matching monitored watch is plain mail: cancel never drops it",
		() => {
			const store = storage();
			return Effect.gen(function* () {
				yield* seed(store);
				yield* monitor(store, "watch:1");
				yield* monitor(store, "real", X);
				yield* cancel(store, "watch:1");
				yield* exit(store, X);
				// The manager's signal id for (to, ref), checked against a real signal.
				const signalId = (ref: string) => JSON.stringify(["DOWN", toW, ref]);
				expect(signals(store).map((row) => row.id)).toEqual([signalId("real")]);
				// watch:1 targets A, so a DOWN for B under watch:1's signal id matches no watch.
				const id = signalId("watch:1");
				yield* send(store, id, Down.make({ref: "watch:1", process: B, why: "crashed", to: toW}));
				expect((yield* fresh(store)).map((letter) => letter.id)).toEqual([signalId("real"), id]);
			});
		},
	);
	it.effect(
		"a malformed DOWN-tagged row never throws or wedges the inbox: later receives still work",
		() => {
			const store = storage();
			return Effect.gen(function* () {
				yield* seed(store);
				yield* send(store, "bad", {_tag: "DOWN", ref: 5});
				yield* send(store, "good", {hello: 1});
				expect((yield* fresh(store)).map((letter) => letter.id)).toEqual(["bad", "good"]);
				const last = (yield* fresh(store)).at(-1)!;
				yield* send(store, "later", {hello: 2});
				expect((yield* fresh(store, W, last.rev)).map((letter) => letter.id)).toEqual(["later"]);
			});
		},
	);
});

describe("P33, watches are keyed by (recipient, ref)", () => {
	it.effect("two recipients may both use ref watch:1, and each cancel is its own", () => {
		const store = storage();
		return Effect.gen(function* () {
			yield* seed(store);
			yield* monitor(store, "watch:1", A, W);
			yield* monitor(store, "watch:1", A, X);
			yield* cancel(store, "watch:1", X);
			store.reopen();
			yield* exit(store);
			expect(
				(yield* fresh(store)).map((letter) => Schema.decodeUnknownSync(Down)(letter.m)),
			).toEqual([Down.make({ref: "watch:1", process: A, why: "crashed", to: toW})]);
			expect(yield* fresh(store, X)).toEqual([]);
		});
	});
	it.effect("a restarted watcher may reuse its own ref after its old watch ended", () => {
		const store = storage();
		return Effect.gen(function* () {
			yield* seed(store);
			yield* monitor(store, "watch:1");
			yield* exit(store, W);
			yield* ProcessManager.use((p) =>
				p.start(
					Start.cases.again.make({
						id: "watcher:restart",
						after: W,
						why: "crashed",
						name: "watcher:1",
						code: {program: "watcher", hash: "build-a"},
					}),
					from(),
				),
			).pipe(Effect.provide(manager(store, brain(), ids(B).next)));
			yield* monitor(store, "watch:1", A, B);
			yield* exit(store);
			expect(
				(yield* fresh(store, B)).map((letter) => Schema.decodeUnknownSync(Down)(letter.m)),
			).toEqual([
				Down.make({
					ref: "watch:1",
					process: A,
					why: "crashed",
					to: Recipient.cases.process.make({process: B}),
				}),
			]);
		});
	});
});

describe("P33, monitor again after demonitor", () => {
	it.effect(
		"the re-monitor takes effect: the watch is live again and a later exit sends DOWN",
		() => {
			const store = storage();
			return Effect.gen(function* () {
				yield* seed(store);
				yield* monitor(store, "watch:1");
				yield* cancel(store, "watch:1");
				yield* monitor(store, "watch:1");
				store.reopen();
				yield* exit(store);
				expect(
					(yield* fresh(store)).map((letter) => Schema.decodeUnknownSync(Down)(letter.m)),
				).toEqual([Down.make({ref: "watch:1", process: A, why: "crashed", to: toW})]);
			});
		},
	);
});

describe("P33, demonitored records why", () => {
	it.effect("a demonitor writes why canceled; a watcher's exit writes why watcher_exited", () => {
		const store = storage();
		return Effect.gen(function* () {
			yield* seed(store);
			yield* monitor(store, "by-cancel", A, W);
			yield* monitor(store, "by-exit", A, X);
			yield* cancel(store, "by-cancel");
			yield* exit(store, X);
			expect(Object.fromEntries(demonitored(store).map((body) => [body.ref, body.why]))).toEqual({
				"by-cancel": "canceled",
				"by-exit": "watcher_exited",
			});
		});
	});
});
