// p79's OTP monitor rules, P33. Stored mail is read independently of fresh delivery.
import {describe, expect, it} from "@effect/vitest";
import {Effect, Layer, Schema} from "effect";
import * as fc from "fast-check";
import {Doorbell, Ledger} from "../data/ledger.ts";
import {type Entry, lineFor} from "../data/log.ts";
import {fcProcessIds} from "../id.test-support.ts";
import {Mailbox} from "./mailbox.ts";
import {ProcessManager} from "./process-manager.ts";
import {
	A,
	B,
	W,
	X,
	again,
	brain,
	CLIENT,
	first,
	from,
	ids,
	manager,
	receive,
	storage,
	type Storage,
	watcher,
} from "./process.test-support.ts";
import {Down, inSignalSpace, Owner, ProcessTable, Recipient, signalId, Start} from "./process.ts";

const text = fc.string({minLength: 1, maxLength: 256});
const refs = fc.uniqueArray(text, {minLength: 2, maxLength: 2});
const session = fcProcessIds;

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

describe("P33, signal ids, ownership and delivery", () => {
	it("signal ids keep DOWN and JSON whitespace cannot escape the protected id space", () => {
		fc.assert(
			fc.property(text, session, fc.integer({min: 1, max: 20}), (ref, process, round) => {
				const to = Recipient.cases.process.make({process});
				const id = signalId(to, ref, round);
				expect(JSON.parse(id)[0], "signal id protocol starts with DOWN").toBe("DOWN");

				for (const spaces of [" ", "\t", "\n"]) {
					const spaced = `${spaces}[${spaces}${id.slice(1)}`;
					expect(inSignalSpace(spaced), "JSON whitespace does not release a signal id").toBe(true);
				}
			}),
			{seed: 119120, numRuns: 100},
		);
	});
	it.effect("only an existing brain row can satisfy an owed signal", () =>
		check(text, [], (ref) =>
			Effect.gen(function* () {
				for (const own of [true, false]) {
					const store = storage();
					yield* seed(store);
					yield* monitor(store, ref);
					const id = signalId(Recipient.cases.process.make({process: W}), ref, 1);
					yield* Ledger.use((ledger) =>
						ledger.append(
							"watcher:1/inbox",
							id,
							lineFor(from({by: own ? from().by : CLIENT, parent: null}), {
								_tag: "send",
								m: {saved: ref},
							}),
						),
					).pipe(Effect.provide(manager(store)));
					const before = store.rows();
					const result = yield* Effect.result(exit(store));
					expect(result._tag, "only the brain's existing signal counts").toBe(
						own ? "Success" : "Failure",
					);

					if (own) {
						expect(store.rows().filter((row) => row.id === id)).toEqual(
							before.filter((row) => row.id === id),
						);
					} else {
						expect(result).toMatchObject({_tag: "Failure", failure: {why: "refused"}});
						expect(store.rows()).toEqual(before);
					}
				}
			}),
		),
	);
	it.effect("monitor refs reject empty and over-cap text", () =>
		check(fc.string({minLength: 257, maxLength: 300}), [], (long) => {
			const store = storage();
			return Effect.gen(function* () {
				yield* seed(store);
				const table = new ProcessTable(store.rows(), from().by);

				for (const ref of ["", long]) {
					expect(table.monitor(ref, A, Recipient.cases.process.make({process: W}))).toMatchObject({
						_tag: "Failure",
						failure: {why: "bad_text"},
					});
				}
			});
		}),
	);
	it.effect("signal delivery checks both the watched target and the receiving process", () =>
		check(text, [], (ref) => {
			const store = storage();
			return Effect.gen(function* () {
				yield* seed(store);
				yield* monitor(store, ref);
				const table = new ProcessTable(store.rows(), from().by);
				const to = Recipient.cases.process.make({process: W});
				const down = Down.make({ref, process: A, to, why: "crashed"});
				const entry: Entry = {
					...lineFor(from(), {_tag: "send", m: down}),
					id: signalId(to, ref, 1),
					stream: "watcher:1/inbox",
					rev: 100,
					pos: 1,
					arrivedAt: 0,
				};
				expect(table.deliver(entry, down, W)).toBe("signal");
				expect(table.deliver(entry, {...down, process: B}, W), "another target is plain mail").toBe(
					"mail",
				);
				expect(table.deliver(entry, down, X), "another recipient drops the signal").toBe("drop");
			});
		}),
	);
});

describe("p79, addressed and independent monitors", () => {
	for (const ended of [false, true]) {
		it.effect(`an ${ended ? "ended" : "absent"} watcher cannot create a monitor`, () => {
			return check(text, ["late-watch"], (ref) => {
				const store = storage();
				return Effect.gen(function* () {
					if (ended) {
						yield* seed(store);
						yield* exit(store, W);
					}

					const before = store.rows();
					expect((yield* Effect.flip(monitor(store, ref))).why).toBe("ended");
					expect(store.rows()).toEqual(before);
				});
			});
		});
	}

	it.effect(
		"plant, omit to or collapse monitors: each reference gets one stable addressed DOWN",
		() =>
			check(
				fc.uniqueArray(text, {minLength: 3, maxLength: 3}),
				[["watch:1", "watch:2", "other:1"]],
				([one, two, other]) => {
					const store = storage();
					return Effect.gen(function* () {
						yield* seed(store);
						yield* monitor(store, one!);
						yield* monitor(store, one!);
						yield* monitor(store, two!);
						yield* monitor(store, other!, A, X);
						store.reopen();
						yield* exit(store);
						yield* exit(store);
						yield* monitor(store, one!);
						const mail = signals(store);
						expect(mail).toHaveLength(3);
						expect(new Set(mail.map((row) => row.id)).size).toBe(3);
						expect(mail.map((row) => row.m).sort((a, b) => a.ref.localeCompare(b.ref))).toEqual(
							[
								Down.make({
									ref: other!,
									process: A,
									why: "crashed",
									to: Recipient.cases.process.make({process: X}),
								}),
								Down.make({
									ref: one!,
									process: A,
									why: "crashed",
									to: Recipient.cases.process.make({process: W}),
								}),
								Down.make({
									ref: two!,
									process: A,
									why: "crashed",
									to: Recipient.cases.process.make({process: W}),
								}),
							].sort((a, b) => a.ref.localeCompare(b.ref)),
						);
						expect((yield* fresh(store)).map((letter) => letter.id).sort()).toEqual(
							mail
								.filter((row) => row.m.to._tag === "process" && row.m.to.process === W)
								.map((row) => row.id)
								.sort(),
						);
					});
				},
			),
	);
	it.effect(
		"plant, accept another recipient's reference: a ref cannot be stolen or retargeted",
		() =>
			check(text, ["watch:1"], (ref) => {
				const store = storage();
				return Effect.gen(function* () {
					yield* seed(store);
					yield* monitor(store, ref);
					const before = store.rows();
					expect((yield* Effect.flip(monitor(store, ref, W))).why).toBe("bad_ref");
					// Watches are keyed by (recipient, ref): X has no watch:1, so its cancel is a no-op.
					yield* cancel(store, ref, X);
					expect(store.rows()).toEqual(before);
					yield* exit(store);
					expect(signals(store)[0]?.m.process).toBe(A);
				});
			}),
	);

	for (const ended of [false, true]) {
		it.effect(
			`plant, wait forever: monitoring an ${ended ? "ended" : "absent"} ID queues noproc before returning`,
			() =>
				check(text, ["missing"], (ref) => {
					const store = storage();
					return Effect.gen(function* () {
						yield* seed(store);

						if (ended) {
							yield* exit(store);
						}

						const target = ended ? A : B;
						yield* monitor(store, ref, target);
						expect(signals(store)).toHaveLength(1);
						expect(signals(store)[0]?.m).toEqual(
							Down.make({
								ref,
								process: target,
								why: "noproc",
								to: Recipient.cases.process.make({process: W}),
							}),
						);
						const saved = signals(store);
						store.reopen();
						yield* monitor(store, ref, target);
						expect(signals(store)).toEqual(saved);
						expect(yield* fresh(store)).toHaveLength(1);
					});
				}),
		);
	}

	it.effect(
		"plant, address only a client name: a window monitor records the exact connection session",
		() =>
			check(session, [X], (session) => {
				const store = storage();
				const caller = {
					...brain(),
					recipient: Recipient.cases.client.make({client: "window-a", session}),
				};
				return Effect.gen(function* () {
					yield* seed(store);
					yield* ProcessManager.use((p) => p.monitor("window:1", A, from())).pipe(
						Effect.provide(manager(store, caller)),
					);
					yield* exit(store);
					expect(signals(store)[0]?.m.to).toEqual(caller.recipient);
				});
			}),
	);
	it.effect("plant, retain a dead watcher's monitors: ending it removes its outbound watches", () =>
		check(text, ["watch:1"], (ref) => {
			const store = storage();
			return Effect.gen(function* () {
				yield* seed(store);
				yield* monitor(store, ref);
				yield* exit(store, W);
				store.reopen();
				yield* exit(store);
				expect(signals(store)).toEqual([]);
			});
		}),
	);
});

describe("p79, atomic exit", () => {
	for (const after of [1, 2]) {
		it.effect(
			`plant, separate appends or early rings: failure after ${after} writes rolls back exit and all owed signals`,
			() =>
				check(refs, [["one", "two"]], ([one, two]) => {
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
						yield* monitor(store, one!);
						yield* monitor(store, two!, A, X);
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
				}),
		);
	}
});

describe("p79, cancellation, replay and stale delivery", () => {
	for (const queued of [false, true]) {
		it.effect(
			`plant, remove only the watch row: cancel ${queued ? "after enqueue" : "before exit"} survives reopen`,
			() =>
				check(refs, [["canceled", "kept"]], ([canceled, kept]) => {
					const store = storage();
					return Effect.gen(function* () {
						yield* seed(store);
						yield* monitor(store, canceled!);
						yield* monitor(store, kept!);

						if (queued) {
							yield* exit(store);
						}

						yield* cancel(store, canceled!);
						yield* cancel(store, canceled!);
						store.reopen();

						if (!queued) {
							yield* exit(store);
						}

						const delivered = yield* fresh(store);
						expect(delivered.map((letter) => Schema.decodeUnknownSync(Down)(letter.m).ref)).toEqual(
							[kept],
						);
						expect(
							signals(store)
								.map((row) => row.m.ref)
								.sort(),
						).toEqual(queued ? [canceled!, kept!].sort() : [kept]);
						expect(
							store.rows().filter((row) => row._tag === "demonitored").length,
						).toBeGreaterThanOrEqual(1);
					});
				}),
		);
	}

	it.effect("plant, resolve a name at delivery: an old DOWN never retargets a replacement", () => {
		return check(refs, [["old-target", "new-target"]], ([oldRef, newRef]) => {
			const store = storage();
			return Effect.gen(function* () {
				yield* seed(store);
				yield* monitor(store, oldRef!);
				yield* exit(store);
				yield* ProcessManager.use((p) => p.start(again(A), from())).pipe(
					Effect.provide(manager(store, brain(), ids(B).next)),
				);
				yield* monitor(store, newRef!, B);
				store.reopen();
				const old = yield* fresh(store);
				expect(old).toHaveLength(1);
				expect(Schema.decodeUnknownSync(Down)(old[0]!.m).process).toBe(A);
				yield* exit(store, B);
				const later = yield* fresh(store, W, old[0]!.rev);
				expect(later.map((letter) => Schema.decodeUnknownSync(Down)(letter.m).process)).toEqual([
					B,
				]);
			});
		});
	});
	it.effect("plant, reuse a watcher's inbox: a new watcher life cannot receive an old signal", () =>
		check(
			text.filter((ref) => ref !== "new-life-ref"),
			["same-ref"],
			(ref) => {
				const store = storage();
				return Effect.gen(function* () {
					yield* seed(store);
					yield* monitor(store, ref);
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
		),
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
		return check(text, ["watch:1"], (ref) => {
			const store = storage();
			return Effect.gen(function* () {
				yield* seed(store);
				yield* monitor(store, ref);
				yield* cancel(store, ref);
				yield* send(store, "forged", Down.make({ref, process: A, why: "crashed", to: toW}));
				expect((yield* fresh(store)).map((letter) => letter.id)).toEqual(["forged"]);
			});
		});
	});
	it.effect(
		"a DOWN under its signal id with no matching monitored watch is plain mail: cancel never drops it",
		() =>
			check(
				text.filter((ref) => ref !== "real"),
				["watch:1"],
				(ref) => {
					const store = storage();
					return Effect.gen(function* () {
						yield* seed(store);
						yield* monitor(store, ref);
						yield* monitor(store, "real", X);
						yield* cancel(store, ref);
						yield* exit(store, X);
						const real = signals(store).map((row) => row.id);
						expect(real).toHaveLength(1);
						// watch:1 targets A, so a DOWN for B under a signal id matches no watch. Mail cannot
						// take a signal id, so only another writer's raw row could, and it is plain mail.
						const id = JSON.stringify(["DOWN", toW, ref, 1]);
						const m = Down.make({ref, process: B, why: "crashed", to: toW});
						yield* Ledger.use((ledger) =>
							ledger.append("watcher:1/inbox", id, lineFor(from({by: CLIENT}), {_tag: "send", m})),
						).pipe(Effect.provide(manager(store)));
						expect((yield* fresh(store)).map((letter) => letter.id)).toEqual([...real, id]);
					});
				},
			),
	);
	it.effect(
		"a malformed DOWN-tagged row never throws or wedges the inbox: later receives still work",
		() =>
			check(fc.oneof(fc.integer(), fc.boolean(), fc.constant(null)), [5], (badRef) => {
				const store = storage();
				return Effect.gen(function* () {
					yield* seed(store);
					yield* send(store, "bad", {_tag: "DOWN", ref: badRef});
					yield* send(store, "good", {hello: 1});
					expect((yield* fresh(store)).map((letter) => letter.id)).toEqual(["bad", "good"]);
					const last = (yield* fresh(store)).at(-1)!;
					yield* send(store, "later", {hello: 2});
					expect((yield* fresh(store, W, last.rev)).map((letter) => letter.id)).toEqual(["later"]);
				});
			}),
	);
});

describe("P33, watches are keyed by (recipient, ref)", () => {
	it.effect("two recipients may both use ref watch:1, and each cancel is its own", () => {
		return check(text, ["watch:1"], (ref) => {
			const store = storage();
			return Effect.gen(function* () {
				yield* seed(store);
				yield* monitor(store, ref, A, W);
				yield* monitor(store, ref, A, X);
				yield* cancel(store, ref, X);
				store.reopen();
				yield* exit(store);
				expect(
					(yield* fresh(store)).map((letter) => Schema.decodeUnknownSync(Down)(letter.m)),
				).toEqual([Down.make({ref, process: A, why: "crashed", to: toW})]);
				expect(yield* fresh(store, X)).toEqual([]);
			});
		});
	});
	it.effect("a restarted watcher may reuse its own ref after its old watch ended", () => {
		return check(text, ["watch:1"], (ref) => {
			const store = storage();
			return Effect.gen(function* () {
				yield* seed(store);
				yield* monitor(store, ref);
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
				yield* monitor(store, ref, A, B);
				yield* exit(store);
				expect(
					(yield* fresh(store, B)).map((letter) => Schema.decodeUnknownSync(Down)(letter.m)),
				).toEqual([
					Down.make({
						ref,
						process: A,
						why: "crashed",
						to: Recipient.cases.process.make({process: B}),
					}),
				]);
			});
		});
	});
});

describe("P33, monitor again after demonitor", () => {
	it.effect(
		"the re-monitor takes effect: the watch is live again and a later exit sends DOWN",
		() =>
			check(text, ["watch:1"], (ref) => {
				const store = storage();
				return Effect.gen(function* () {
					yield* seed(store);
					yield* monitor(store, ref);
					yield* cancel(store, ref);
					yield* monitor(store, ref);
					store.reopen();
					yield* exit(store);
					expect(
						(yield* fresh(store)).map((letter) => Schema.decodeUnknownSync(Down)(letter.m)),
					).toEqual([Down.make({ref, process: A, why: "crashed", to: toW})]);
				});
			}),
	);
});

describe("P33, demonitored records why", () => {
	it.effect("a demonitor writes why canceled; a watcher's exit writes why watcher_exited", () => {
		return check(refs, [["by-cancel", "by-exit"]], ([byCancel, byExit]) => {
			const store = storage();
			return Effect.gen(function* () {
				yield* seed(store);
				yield* monitor(store, byCancel!, A, W);
				yield* monitor(store, byExit!, A, X);
				yield* cancel(store, byCancel!);
				yield* exit(store, X);
				expect(Object.fromEntries(demonitored(store).map((body) => [body.ref, body.why]))).toEqual({
					[byCancel!]: "canceled",
					[byExit!]: "watcher_exited",
				});
			});
		});
	});
});

describe("P33, a client's inbox is not a process's inbox", () => {
	// A client and a process may share a name. Each DOWN lands in its own recipient's inbox only.
	const clientName = fc
		.stringMatching(/^[a-z][a-z0-9._-]{0,20}$/)
		.filter((name) => name !== "processes" && name !== "door");
	const notesClient = (client: string) => Recipient.cases.client.make({client, session: X});
	const twin = (store: Storage, name: string, client: string) =>
		Effect.gen(function* () {
			yield* seed(store);
			const placed = yield* Effect.exit(
				ProcessManager.use((p) =>
					p.start(first(`start:${name}`, name, {program: "notes", hash: "build-a"}), from()),
				).pipe(Effect.provide(manager(store, brain(), ids(B).next))),
			);

			if (placed._tag === "Failure") {
				return false;
			}

			yield* ProcessManager.use((p) => p.monitor("watch:notes", A, from())).pipe(
				Effect.provide(manager(store, watcher(B))),
			);
			yield* ProcessManager.use((p) => p.monitor("watch:notes", A, from())).pipe(
				Effect.provide(
					manager(store, {owner: Owner.cases.brain.make({}), recipient: notesClient(client)}),
				),
			);
			yield* exit(store);
			return true;
		});
	it.effect("a client notes and a process notes each get their DOWN in their own inbox", () => {
		return check(clientName, ["notes"], (name) => {
			const store = storage();
			return Effect.gen(function* () {
				expect(yield* twin(store, name, name)).toBe(true);
				const downs = signals(store);
				const forProcess = downs.filter((down) => down.m.to._tag === "process");
				const forClient = downs.filter((down) => down.m.to._tag === "client");
				expect(forProcess.map((down) => down.stream)).toEqual([`${name}/inbox`]);
				expect(forClient.map((down) => down.m.to)).toEqual([notesClient(name)]);
				expect(forClient.map((down) => down.stream)).toEqual([`client:${name}/inbox`]);
				const letters = yield* fresh(store, B);
				expect(letters.map((letter) => letter.m)).toEqual([forProcess[0]!.m]);
			});
		});
	});
	it.effect("plain mail to process notes never reaches client notes's inbox", () => {
		return check(clientName, ["notes"], (name) => {
			const store = storage();
			return Effect.gen(function* () {
				expect(yield* twin(store, name, name)).toBe(true);
				yield* Mailbox.use((mail) => mail.send(name, "letter:1", {hello: name}, from())).pipe(
					Effect.provide(manager(store)),
				);
				const rows = store.rows().filter((row) => row.id === "letter:1");
				expect(rows.map((row) => row.stream)).toEqual([`${name}/inbox`]);
				const clientInbox = store.rows().filter((row) => row.stream === `client:${name}/inbox`);
				expect(clientInbox.map((row) => row.id)).not.toContain("letter:1");
				expect(clientInbox).toHaveLength(1);
			});
		});
	});
	it.effect("a process named client:notes never shares client notes's inbox", () => {
		return check(clientName, ["notes"], (name) => {
			const store = storage();
			return Effect.gen(function* () {
				// Refusing the name or giving it another inbox both keep the two apart.
				if (!(yield* twin(store, `client:${name}`, name))) {
					return;
				}

				const downs = signals(store);
				const forProcess = downs.filter((down) => down.m.to._tag === "process");
				const forClient = downs.filter((down) => down.m.to._tag === "client");
				expect(forProcess).toHaveLength(1);
				expect(forClient).toHaveLength(1);
				expect(forClient[0]!.stream).not.toBe(forProcess[0]!.stream);
			});
		});
	});
});
