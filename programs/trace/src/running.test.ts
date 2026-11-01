import {replay} from "@demlik/tea";
import {ATTR, type JobTrace, memoryStorage, type Span, start, Traces} from "@kampus/fabrika-old";
import {Duration, Effect, Layer, Option, Queue, Stream} from "effect";
import {TestClock} from "effect/testing";
import {describe, expect, it} from "vitest";
import {trace as program, TICK} from "./index.ts";
import {type Model, type TraceMsg, ticking, trace} from "./machine.ts";
import {TALLY_ID, TALLY_TRACE} from "./tally.ts";
import {treeOf} from "./tree.ts";
import {shownOf} from "./view.ts";

// A job that has not ended, as its record says it (`job.ended` is `null`): the machine holds the
// time while a tick runs, and the view draws no finished run from a record with nothing in it.

const STARTED = 1000;
const job = {n: 1, text: "counter", by: "user:owner", host: "laptop", started: STARTED};
const just: JobTrace = {
	trace: TALLY_ID,
	job: {...job, ended: null},
	runs: [],
	spans: [],
	steps: [],
	opened: [],
};
const stepping: JobTrace = {
	...just,
	steps: [
		{
			run: "counter:1a2b3c4d",
			machine: "count",
			id: "count",
			n: 1,
			at: STARTED + 200,
			msg: {type: "add"},
			state: {count: 1},
			cmds: [],
			by: "user:owner",
		},
	],
};
const span = (more: Partial<Span>): Span => ({
	span: "a1b2c3d4e5f60708",
	parent: null,
	name: "tsh",
	service: "tsh",
	start: STARTED,
	end: STARTED + 2000,
	status: "ok",
	tags: {},
	events: [],
	by: "user:owner",
	...more,
});
const ended: JobTrace = {
	...stepping,
	job: {...job, ended: {how: "done", at: STARTED + 2000}},
	// As tsh writes them: the line's span and the run's name the same run.
	spans: [
		span({tags: {[ATTR.line]: "counter", [ATTR.run]: "counter:1a2b3c4d"}}),
		span({
			span: "b1b2c3d4e5f60708",
			parent: "a1b2c3d4e5f60708",
			name: "run",
			service: "counter",
			tags: {[ATTR.run]: "counter:1a2b3c4d"},
		}),
	],
};

const after = (...msgs: readonly TraceMsg[]): Model => replay(trace, {ctx: undefined, msgs}).state;
const look: TraceMsg = {type: "look", id: TALLY_ID};
const got = (t: JobTrace): TraceMsg => ({type: "got", trace: t});
const tick = (now: number): TraceMsg => ({type: "tick", now});
const nowIn = (s: Model) => (s.read.at === "read" ? s.read.now : "not read");

describe("the machine, on a job that has not ended", () => {
	it("ticks while the record says it runs, and holds the time each tick brings", () => {
		const first = after(look, got(just));
		expect(ticking(first)).toEqual({id: TALLY_ID});
		expect(nowIn(first)).toBeNull();
		expect(nowIn(after(look, got(just), tick(4000), tick(5000)))).toBe(5000);
	});

	it("keeps the time across a newer read of the job, while it runs", () => {
		expect(nowIn(after(look, got(just), tick(4000), got(stepping)))).toBe(4000);
	});

	it("does not tick before a record is read, or once the job ended, and lets go of the time", () => {
		expect(ticking(after(look))).toBeNull();
		const done = after(look, got(just), tick(4000), got(ended));
		expect(ticking(done)).toBeNull();
		expect(nowIn(done)).toBeNull();
		expect(nowIn(after(look, got(just), got(ended), tick(9000)))).toBeNull();
	});

	it("does not tick for a record with no job: nothing says it runs", () => {
		expect(ticking(after(look, got({...just, job: null})))).toBeNull();
	});
});

describe("what the window is shown", () => {
	it("a job with nothing in it: running, with the time so far, and nothing that opens", () => {
		expect(shownOf(after(look, got(just))).running).toEqual({took: null});
		const shown = shownOf(after(look, got(just), tick(STARTED + 12_000)));
		expect(shown.running).toEqual({took: 12_000});
		expect(shown.rows.map((r) => [r.name, r.opens])).toEqual([["counter", false]]);
	});

	it("a job with steps: the time and the axis grow with the clock, and its row runs to now", () => {
		const shown = shownOf(after(look, got(stepping), tick(STARTED + 5000)));
		expect(shown.running).toEqual({took: 5000});
		expect(shown.length).toBe(5000);
		expect(shown.rows[0]?.to).toBe(5000);
		// The axis never falls behind the last moment in the record.
		expect(shownOf(after(look, got(stepping), tick(STARTED + 100))).length).toBe(200);
	});

	it("an ended job: not running, its final time from the record", () => {
		const shown = shownOf(after(look, got(just), tick(STARTED + 99_000), got(ended)));
		expect(shown.running).toBeNull();
		expect(shown.length).toBe(2000);
	});

	it("keeps one name on the job's row, and tsh first in the legend, from start to end", () => {
		const seen = [just, stepping, ended].map((t) => {
			const shown = shownOf(after(look, got(t)));
			return [shown.rows[0]?.name, shown.services];
		});
		expect(seen).toEqual([
			["counter", ["tsh"]],
			["counter", ["tsh", "counter"]],
			["counter", ["tsh", "counter"]],
		]);
	});
});

describe("the job's row", () => {
	it("is the job's while it runs, not the one span in so far", () => {
		const seq = span({
			parent: "ffffffffffffffff",
			name: "run",
			service: "seq",
			tags: {[ATTR.run]: "seq-1a2b3c4d"},
		});
		const tree = treeOf({...just, spans: [seq]});
		expect([tree.kind, tree.name, tree.service]).toEqual(["job", "counter", "tsh"]);
		expect(tree.children.map((c) => [c.kind, c.name])).toEqual([["run", "seq"]]);
	});

	it("takes the line's own span once it is in", () => {
		const tree = treeOf(ended);
		expect([tree.kind, tree.name, tree.of.kind]).toEqual(["job", "counter", "span"]);
		// It is the job's row, not a row of its own under the job.
		expect(tree.children.some((c) => c.service === "tsh" && c.name === "tsh")).toBe(false);
	});

	it("with no job in the record, is named by what the record does hold", () => {
		expect(treeOf({...TALLY_TRACE, job: null}).name).toBe("seq --to 3 | tally");
	});
});

describe("the tick", () => {
	it("comes at once and every TICK while the job runs, and stops when it ends", async () => {
		const seen = await Effect.runPromise(
			Effect.gen(function* () {
				const reads = yield* Queue.unbounded<JobTrace>();
				const growing = Layer.succeed(
					Traces,
					Traces.of({read: () => Queue.take(reads), watch: () => Stream.fromQueue(reads)}),
				);
				const started = yield* start(
					program,
					{id: TALLY_ID},
					{},
					{id: "trace:test", storage: memoryStorage()},
				).pipe(Effect.provide(growing));
				if (started.kind !== "running") return yield* Effect.die("it did not start");
				const until = (ok: (s: Model) => boolean) =>
					started.run.machines.trace.changes.pipe(
						Stream.filter((s): s is Model => s !== null),
						Stream.filter(ok),
						Stream.runHead,
						Effect.map(Option.getOrThrow),
					);
				const at = (now: number) => (s: Model) => nowIn(s) === now;
				const every = Duration.toMillis(TICK);
				yield* TestClock.adjust(STARTED);
				yield* Queue.offer(reads, just);
				const first = yield* until(at(STARTED));
				yield* TestClock.adjust(every);
				const next = yield* until(at(STARTED + every));
				yield* Queue.offer(reads, ended);
				const done = yield* until((s) => s.read.at === "read" && s.read.trace.job?.ended !== null);
				yield* TestClock.adjust(every * 3);
				const still = yield* until((s) => s.read.at === "read");
				return [first, next, done, still].map(nowIn);
			}).pipe(Effect.scoped, Effect.provide(TestClock.layer())),
		);
		expect(seen).toEqual([STARTED, STARTED + 1000, null, null]);
	});
});
