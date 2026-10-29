import {type JobTrace, memoryStorage, offer, readInput, start, type Word} from "@kampus/fabrika";
import {Effect, Option, Stream} from "effect";
import {describe, expect, it} from "vitest";
import {type Do, trace} from "./index.ts";
import {memoryTraces} from "./memory.ts";
import {TALLY_ID, TALLY_TRACE} from "./tally.ts";
import {nodesOf, treeOf} from "./tree.ts";
import {type Shown, shownOf} from "./view.ts";

// The trace program with no window, on the `seq --to 3 | tally` record held in memory. Told what
// its window sends, it opens the rows named, down to one step, and shows that step's Msg, the
// state before and after, and its Cmds: the done-when of the trace tile (#74).

/** The key of the row named `name` in a record's tree. */
const keyOf = (record: JobTrace, name: string): string => {
	const found = nodesOf(treeOf(record)).find((n) => n.name === name);
	if (found === undefined) throw new Error(`no row ${name}`);
	return found.key;
};

const session = (records: readonly JobTrace[], id: string) =>
	Effect.gen(function* () {
		const started = yield* start(trace, {id}, {}, {id: "trace:test", storage: memoryStorage()});
		if (started.kind !== "running") return yield* Effect.die("the trace program did not start");
		const {run} = started;
		const say = (d: Do): Effect.Effect<Word> => offer(run, "do", d);
		const until = (ok: (shown: Shown) => boolean) =>
			run.machines.trace.changes.pipe(
				Stream.filter((s) => s !== null),
				Stream.map(shownOf),
				Stream.filter(ok),
				Stream.runHead,
				Effect.map(Option.getOrThrow),
			);
		return {run, say, until};
	}).pipe(Effect.provide(memoryTraces(records)));

describe("the trace program", () => {
	it("opens tally, count total, add 2: total 1 before, 3 after, and no Cmds", async () => {
		const tally = keyOf(TALLY_TRACE, "tally");
		const count = keyOf(TALLY_TRACE, "count total");
		const add2 = keyOf(TALLY_TRACE, "add 2");
		const seen = await Effect.runPromise(
			Effect.gen(function* () {
				const {run, say, until} = yield* session([TALLY_TRACE], TALLY_ID);
				const first = yield* until((s) => s.read === "read");
				yield* say({kind: "toggle", row: tally});
				yield* say({kind: "toggle", row: count});
				yield* say({kind: "choose", row: add2});
				const opened = yield* until((s) => s.chosen !== null);
				yield* say({kind: "quit"});
				return {first, opened, ended: (yield* run.ended).kind};
			}).pipe(Effect.scoped),
		);

		// As it first opens: the job's row is open, its two runs show, closed.
		expect(seen.first.title).toBe("seq --to 3 | tally");
		expect(seen.first.rows.map((r) => [r.depth, r.name, r.open])).toEqual([
			[0, "seq --to 3 | tally", true],
			[1, "seq", false],
			[1, "tally", false],
		]);

		// Opened down to the step: the path, and the step's detail.
		expect(seen.opened.rows.map((r) => [r.depth, r.kind, r.name])).toEqual([
			[0, "job", "seq --to 3 | tally"],
			[1, "run", "seq"],
			[1, "run", "tally"],
			[2, "machine", "count total"],
			[3, "step", "add 1"],
			[3, "step", "add 2"],
			[3, "step", "add 3"],
		]);
		expect(seen.opened.chosen).toEqual({
			kind: "step",
			key: add2,
			run: "tally-5d02c7a1",
			machine: "count",
			id: "total",
			n: 2,
			at: 6,
			msg: {type: "add", n: 2},
			before: {kind: "kept", state: {total: 1}},
			after: {total: 3},
			changes: [{op: "replace", path: "/total", before: 1, after: 3}],
			cmds: [],
		});
		expect(seen.ended).toBe("ended");
	});

	it("shows the first step's state before as the machine's start, which no row keeps", async () => {
		const add1 = keyOf(TALLY_TRACE, "add 1");
		const chosen = await Effect.runPromise(
			Effect.gen(function* () {
				const {say, until} = yield* session([TALLY_TRACE], TALLY_ID);
				yield* until((s) => s.read === "read");
				yield* say({kind: "choose", row: add1});
				return (yield* until((s) => s.chosen !== null)).chosen;
			}).pipe(Effect.scoped),
		);
		expect(chosen?.kind === "step" && [chosen.before, chosen.after, chosen.changes]).toEqual([
			{kind: "start"},
			{total: 1},
			[],
		]);
	});

	it("closes an open row, and takes no row the record does not hold", async () => {
		const shown = await Effect.runPromise(
			Effect.gen(function* () {
				const {say, until} = yield* session([TALLY_TRACE], TALLY_ID);
				yield* until((s) => s.read === "read");
				yield* say({kind: "toggle", row: "span:ffffffffffffffff"});
				yield* say({kind: "choose", row: "span:ffffffffffffffff"});
				yield* say({kind: "toggle", row: "job"});
				return yield* until((s) => s.rows.length === 1);
			}).pipe(Effect.scoped),
		);
		expect(shown.rows.map((r) => [r.name, r.open])).toEqual([["seq --to 3 | tally", false]]);
		expect(shown.chosen).toBeNull();
	});

	it("reads a trace nobody wrote as an empty record: the job's row alone", async () => {
		const shown = await Effect.runPromise(
			Effect.gen(function* () {
				const {until} = yield* session([], "0".repeat(32));
				return yield* until((s) => s.read === "read");
			}).pipe(Effect.scoped),
		);
		expect(shown.rows.map((r) => [r.kind, r.name, r.opens])).toEqual([["job", "job", false]]);
	});

	it("shows the span detail of a run: its tags, its events, its record", () => {
		const tally = keyOf(TALLY_TRACE, "tally");
		const chosen = shownOf({
			read: {at: "read", trace: TALLY_TRACE},
			open: ["job"],
			chosen: tally,
		}).chosen;
		expect(chosen?.kind).toBe("span");
		if (chosen?.kind !== "span") return;
		expect([chosen.service, chosen.at, chosen.took, chosen.status]).toEqual(["tally", 1, 12, "ok"]);
		expect(chosen.tags).toContainEqual(["tea.run.id", "tally-5d02c7a1"]);
		expect(chosen.events.map((e) => e.name)).toEqual([
			"told add",
			"sent total",
			"told add",
			"sent total",
			"told add",
			"sent total",
		]);
		expect(chosen.run).toEqual({run: "tally-5d02c7a1", status: "ended", flags: {}});
	});

	it("reads what its window sends, and refuses a row it does not know the shape of", () => {
		expect(readInput(trace, {type: "do", value: {kind: "toggle", row: "job"}}).kind).toBe("read");
		expect(readInput(trace, {type: "do", value: {kind: "open", row: "job"}}).kind).toBe("refused");
	});
});
