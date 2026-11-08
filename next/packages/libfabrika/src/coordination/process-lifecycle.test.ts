// P33 / p79. The manager is rebuilt over the same SQLite file for each reopen check.
import {describe, expect, it} from "@effect/vitest";
import {Effect, Exit, Schema} from "effect";
import {Ledger} from "../data/ledger.ts";
import {ProcessId} from "../data/trace.ts";
import {ProcessIdGenerator} from "./process-id.ts";
import {ProcessManager} from "./process-manager.ts";
import {
	A,
	B,
	W,
	X,
	again,
	brain,
	CODE,
	first,
	from,
	ids,
	manager,
	read,
	storage,
	watcher,
} from "./process.test-support.ts";

describe("p79, process identity", () => {
	it.effect(
		"plant, key by build: actual starts use P10's distinct valid IDs on the same build",
		() =>
			Effect.gen(function* () {
				const generated = yield* ProcessIdGenerator;
				const store = storage();
				yield* Effect.gen(function* () {
					const processes = yield* ProcessManager;
					const answers = yield* Effect.forEach(
						Array.from({length: 24}, (_, i) => i),
						(i) => processes.start(first(`start:${i}`, `counter:${i}`), from()),
						{concurrency: 1},
					);
					expect(new Set(answers.map((answer) => answer.process)).size).toBe(24);
					for (const answer of answers) expect(Schema.is(ProcessId)(answer.process)).toBe(true);
				}).pipe(Effect.provide(manager(store, brain(), generated.next)));
			}).pipe(Effect.provide(ProcessIdGenerator.layer)),
	);
	it.effect(
		"plant, accept a generated collision: no reservation or start is partially written",
		() => {
			const store = storage();
			return Effect.gen(function* () {
				yield* ProcessManager.use((p) => p.start(first(), from())).pipe(
					Effect.provide(manager(store, brain(), ids(A).next)),
				);
				store.reopen();
				const before = store.rows();
				expect(
					(yield* Effect.flip(
						ProcessManager.use((p) => p.start(first("start:other", "counter:2"), from())).pipe(
							Effect.provide(manager(store, brain(), ids(A).next)),
						),
					)).why,
				).toBe("id_collision");
				expect(store.rows()).toEqual(before);
			});
		},
	);
	it.effect("plant, reuse a request ID with changed code or name: both changes are refused", () => {
		const store = storage();
		return Effect.gen(function* () {
			const processes = yield* ProcessManager;
			yield* processes.start(first(), from());
			const before = store.rows();
			for (const changed of [
				first("start:counter:1", "counter:2"),
				first("start:counter:1", "counter:1", {...CODE, hash: "build-b"}),
			]) {
				expect((yield* Effect.flip(processes.start(changed, from()))).why).toBe("id_reused");
			}
			expect(store.rows()).toEqual(before);
		}).pipe(Effect.provide(manager(store, brain(), ids(A).next)));
	});
	it.effect(
		"plant, retry allocates after wake: a rebuilt manager returns the saved answer without IDs",
		() => {
			const store = storage();
			const unused = ids();
			return Effect.gen(function* () {
				const answer = yield* ProcessManager.use((p) => p.start(first(), from())).pipe(
					Effect.provide(manager(store, brain(), ids(A).next)),
				);
				store.reopen();
				const retry = yield* ProcessManager.use((p) =>
					p.start(first(), from({sentAt: "future", build: "new-writer", seen: 999})),
				).pipe(Effect.provide(manager(store, brain(), unused.next)));
				expect(retry).toEqual(answer);
				expect(unused.calls()).toBe(0);
			});
		},
	);
});

describe("p79, predecessors and live info", () => {
	it.effect("plant, restart a live process: an ended current predecessor is required", () => {
		const store = storage();
		return Effect.gen(function* () {
			const processes = yield* ProcessManager;
			yield* processes.start(first(), from());
			const before = store.rows();
			expect((yield* Effect.flip(processes.start(again(A), from()))).why).toBe("alive");
			expect(store.rows()).toEqual(before);
		}).pipe(Effect.provide(manager(store)));
	});
	it.effect(
		"plant, two successors: concurrent attempts accept only one and reject a stale predecessor",
		() => {
			const store = storage();
			return Effect.gen(function* () {
				const processes = yield* ProcessManager;
				yield* processes.start(first(), from());
				yield* processes.exit(A, "crashed", from());
				const answers = yield* Effect.forEach(
					["restart:one", "restart:two"],
					(id) => Effect.exit(processes.start(again(A, id), from())),
					{concurrency: 2},
				);
				expect(answers.filter(Exit.isSuccess)).toHaveLength(1);
				expect(answers.filter(Exit.isFailure)).toHaveLength(1);
				const live = yield* processes.info;
				expect(live).toHaveLength(1);
				const current = live[0]!;
				yield* processes.exit(current.process, "crashed", from());
				expect((yield* Effect.flip(processes.start(again(A, "restart:stale"), from()))).why).toBe(
					"stale",
				);
				expect((yield* read("counter:1")).filter((row) => row._tag === "restarted")).toHaveLength(
					1,
				);
			}).pipe(Effect.provide(manager(store)));
		},
	);
	it.effect(
		"plant, omit after or count retries: predecessor and exact restart total survive reopen",
		() => {
			const store = storage();
			return Effect.gen(function* () {
				yield* Effect.gen(function* () {
					const processes = yield* ProcessManager;
					yield* processes.start(first(), from());
					yield* processes.start(
						first("watcher:start", "watcher:1", {program: "watcher", hash: "build-a"}),
						from(),
					);
					yield* processes.exit(A, "crashed", from());
					const b = yield* processes.start(
						again(A, "restart:a", {...CODE, hash: "build-b"}),
						from(),
					);
					expect(b.process).toBe(B);
					expect(
						yield* processes.start(again(A, "restart:a", {...CODE, hash: "build-b"}), from()),
					).toEqual(b);
					yield* processes.exit(B, "crashed", from());
					const x = yield* processes.start(again(B), from());
					expect(x.process).toBe(X);
					const facts = (yield* read("counter:1")).filter((row) => row._tag === "restarted");
					expect(facts.map((row) => row.body)).toEqual([
						{process: B, after: A, name: "counter:1", why: "crashed", build: "build-b"},
						{process: X, after: B, name: "counter:1", why: "crashed", build: "build-a"},
					]);
					expect(
						facts.every((row) => row.parent === from().parent && row.build === "writer-build"),
					).toBe(true);
				}).pipe(Effect.provide(manager(store, brain(), ids(A, W, B, X).next)));
				store.reopen();
				yield* Effect.gen(function* () {
					const processes = yield* ProcessManager;
					expect(
						(yield* processes.info)
							.map(({process, name, program, build, restarts}) => ({
								process,
								name,
								program,
								build,
								restarts,
							}))
							.sort((a, b) => a.name.localeCompare(b.name)),
					).toEqual([
						{process: X, name: "counter:1", program: "counter", build: "build-a", restarts: 2},
						{process: W, name: "watcher:1", program: "watcher", build: "build-a", restarts: 0},
					]);
					expect(yield* processes.isLive(A)).toBe(false);
					expect(yield* processes.isLive(B)).toBe(false);
					expect(yield* processes.isLive(X)).toBe(true);
					expect(yield* processes.isLive(W)).toBe(true);
				}).pipe(Effect.provide(manager(store, brain(), ids().next)));
			});
		},
	);
	it.effect(
		"plant, overwrite exit reason: the first exact reason is durable and written once",
		() => {
			const store = storage();
			return Effect.gen(function* () {
				const processes = yield* ProcessManager;
				yield* processes.start(first(), from());
				yield* processes.exit(A, "shutdown:requested", from());
				yield* processes.exit(A, "shutdown:requested", from());
				yield* Effect.exit(processes.exit(A, "crashed", from()));
				const exits = (yield* read("counter:1")).filter((row) => row._tag === "exited");
				expect(exits.map((row) => row.body)).toEqual([{process: A, why: "shutdown:requested"}]);
				expect(yield* processes.info).toEqual([]);
			}).pipe(Effect.provide(manager(store)));
		},
	);
});

describe("p79, names, parents and replay", () => {
	it.effect("plant, free a name on exit: reservation keeps its original program and owner", () => {
		const store = storage();
		return Effect.gen(function* () {
			yield* ProcessManager.use((p) => p.start(first(), from())).pipe(
				Effect.provide(manager(store)),
			);
			yield* ProcessManager.use((p) => p.exit(A, "normal", from())).pipe(
				Effect.provide(manager(store)),
			);
			store.reopen();
			const before = store.rows();
			for (const code of [CODE, {program: "other", hash: "build-a"}]) {
				const error = yield* Effect.flip(
					ProcessManager.use((p) => p.start(first("new:first", "counter:1", code), from())).pipe(
						Effect.provide(manager(store)),
					),
				);
				expect(error.why).toBe("name_taken");
			}
			expect(store.rows()).toEqual(before);
		});
	});
	it.effect("plant, trust From.by: a sibling cannot spoof the parent to exit or restart", () => {
		const store = storage();
		return Effect.gen(function* () {
			yield* Effect.gen(function* () {
				const processes = yield* ProcessManager;
				yield* processes.start(first(), from());
				yield* processes.start(first("sibling:start", "sibling:1"), from());
			}).pipe(Effect.provide(manager(store, brain(), ids(A, W).next)));
			const before = store.rows();
			expect(
				(yield* Effect.flip(
					ProcessManager.use((p) => p.exit(A, "killed", from())).pipe(
						Effect.provide(manager(store, watcher(W))),
					),
				)).why,
			).toBe("not_parent");
			expect(store.rows()).toEqual(before);
			yield* ProcessManager.use((p) => p.exit(A, "normal", from())).pipe(
				Effect.provide(manager(store)),
			);
			expect(
				(yield* Effect.flip(
					ProcessManager.use((p) => p.start(again(A), from())).pipe(
						Effect.provide(manager(store, watcher(W))),
					),
				)).why,
			).toBe("not_parent");
		});
	});
	it.effect(
		"plant, reject additive tags or keep authority only in memory: replay skips unknown facts",
		() => {
			const store = storage();
			return Effect.gen(function* () {
				yield* ProcessManager.use((p) => p.start(first(), from())).pipe(
					Effect.provide(manager(store)),
				);
				const before = store.rows();
				const stream = before.find((row) => row._tag === "registered")!.stream;
				yield* Ledger.use((ledger) =>
					ledger.append(stream, "future", {...from(), _tag: "future_process_fact", body: {v: 2}}),
				).pipe(Effect.provide(manager(store)));
				store.reopen();
				expect(
					yield* ProcessManager.use((p) => p.isLive(A)).pipe(Effect.provide(manager(store))),
				).toBe(true);
				expect(store.rows().some((row) => row._tag === "future_process_fact")).toBe(true);
			});
		},
	);
});
