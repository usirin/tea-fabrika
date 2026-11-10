import {
	arbMsg,
	arbRecordMsg,
	foldEvents,
	type MsgArbitraryTable,
	propertyInvariant,
	type Step,
	stubCtxThrowingProxy,
} from "@demlik/tea/pbt";
import type {JobTrace, MsgOf} from "@kampus/fabrika-old";
import type {Entry} from "@kampus/pipeline/tickets/ticket";
import * as fc from "fast-check";
import {describe, expect, it} from "vitest";
import {type Model, trace} from "./machine.ts";
import {stopsOf} from "./ticket.ts";
import {NUMBER, SOME_STORIES} from "./timelines.ts";

// The trace machine's ticket view, as laws (ticket 141, plan section 4, M1 to M4). Today's
// version. On tea's pbt: the real reducer from its real init, any list of Msgs, the ticket's facts
// drawn from made-up stories (./timelines.ts), a ticket and another, ids of its lanes and one that
// is no lane's. The owner's answer 1 is here too: lanes oldest first, and only the newest opens.
//
// What the plan leaves open, and these laws take as given:
//   - a lane is open while one of its steps has no `ended` or one of its asks no `answered`
//   - "one follow per lane trace id": tea runs one Sub per `subs` entry, so these laws gather the
//     ids every `follow` entry asks for, as `{id}` or `{ids: [...]}`, and want each lane's once
//   - in the job view, `seek` and `step` change nothing: a job view holds no playhead

type Machine = typeof trace;
type Msg = MsgOf<Machine>;
type TraceStep = Step<Model, Msg, never>;
type Got = Extract<Msg, {readonly type: "got"}>;

const OTHER_NUMBER = NUMBER + 1;
const STORIES = SOME_STORIES;
const TIMELINES = STORIES.map((s) => s.timeline);
const NOT_A_LANE = "f".repeat(32);

/** The lanes' trace ids in a timeline, in order of first start. */
const lanesIn = (timeline: readonly Entry[]): readonly string[] => [
	...new Set(timeline.flatMap((e) => (e.fact.type === "started" ? [e.fact.trace ?? ""] : []))),
];

/** A lane is open: a step not ended, or an ask not answered. */
const anyOpen = (timeline: readonly Entry[]): boolean => {
	const ended = new Set(timeline.flatMap((e) => (e.fact.type === "ended" ? [e.fact.run] : [])));
	const answered = new Set(
		timeline.flatMap((e) => (e.fact.type === "answered" ? [e.fact.ask] : [])),
	);
	return timeline.some(
		(e) =>
			(e.fact.type === "started" && !ended.has(e.fact.run)) ||
			(e.fact.type === "asked" && !answered.has(e.fact.ask)),
	);
};

const traces = [...new Set(TIMELINES.flatMap(lanesIn))];
const ids = fc.constantFrom(...traces, NOT_A_LANE);

const record = (id: string): JobTrace => ({
	trace: id,
	job: null,
	runs: [],
	spans: [],
	steps: [],
	opened: [],
});

const times = [...new Set(TIMELINES.flatMap((tl) => tl.map((e) => e.at)))];

const rows = fc.constantFrom(
	...traces.map((t) => `lane:${t}`),
	"job",
	"run:r-plan-2",
	"span:ffffffffffffffff",
);

/** One entry per Msg type: leaving one out does not compile. */
const table: MsgArbitraryTable<Msg> = {
	look: arbRecordMsg("look", {id: ids}),
	got: ids.map((id): Got => ({type: "got", trace: record(id)})),
	lost: arbRecordMsg("lost", {id: ids, why: fc.constant("gone")}),
	toggle: arbRecordMsg("toggle", {row: rows}),
	choose: arbRecordMsg("choose", {row: fc.option(rows, {nil: null})}),
	tick: arbRecordMsg("tick", {now: fc.constantFrom(...times)}),
	ticket: arbRecordMsg("ticket", {number: fc.constantFrom(NUMBER, OTHER_NUMBER)}),
	facts: arbRecordMsg("facts", {
		number: fc.constantFrom(NUMBER, NUMBER, OTHER_NUMBER),
		timeline: fc.constantFrom(...TIMELINES),
	}),
	unread: arbRecordMsg("unread", {
		number: fc.constantFrom(NUMBER, OTHER_NUMBER),
		why: fc.constant("gone"),
	}),
	seek: arbRecordMsg("seek", {
		at: fc.option(fc.oneof(fc.constantFrom(...times), fc.integer()), {nil: null}),
	}),
	step: arbRecordMsg("step", {by: fc.constantFrom(-1, 1)}),
};

const lists = fc.array(arbMsg(table), {maxLength: 30, size: "max"});
const OPTS = {numRuns: 300, seed: 141};
const ctx = stubCtxThrowingProxy<undefined>();

const every = (law: (step: TraceStep) => void) =>
	propertyInvariant(
		trace,
		ctx,
		lists,
		(step) => {
			law(step);
			return true;
		},
		OPTS,
	);

/** The ticket a state shows, or `null` in the job view. */
const numberOf = (s: Model): number | null =>
	s.shows.kind === "ticket" ? s.shows.facts.number : null;

/** The facts a ticket view has read, or `null`. */
const timelineOf = (s: Model): readonly Entry[] | null =>
	s.shows.kind === "ticket" && s.shows.facts.at === "read" ? s.shows.facts.timeline : null;

/** What each Sub entry of `type` asks for in `s`: its deps, each one that is on. */
const depsOf = (type: string, s: Model): readonly unknown[] =>
	(trace.subs ?? []).flatMap((sub): unknown[] => {
		if (sub.type !== type) return [];
		const deps: unknown = sub.deps(s);
		return deps === null || deps === undefined ? [] : [deps];
	});

/** The trace ids the `follow` entries ask for, as `{id}` or `{ids}`. */
const followedIn = (s: Model): readonly string[] =>
	depsOf("follow", s).flatMap((d): string[] => {
		if (typeof d !== "object" || d === null) return [];
		if ("id" in d && typeof d.id === "string") return [d.id];
		if ("ids" in d && Array.isArray(d.ids))
			return d.ids.flatMap((i: unknown) => (typeof i === "string" ? [i] : []));
		return [];
	});

/** The state after these Msgs, from the real init. */
const after = (msgs: readonly Msg[]): Model => foldEvents(trace, ctx, null, msgs).finalState;

/** A ticket shown with these facts read. */
const showing = (timeline: readonly Entry[], more: readonly Msg[] = []): Model =>
	after([{type: "ticket", number: NUMBER}, {type: "facts", number: NUMBER, timeline}, ...more]);

const atOf = (s: Model): number | null | undefined =>
	s.shows.kind === "ticket" ? s.shows.at : undefined;

describe("the trace machine's ticket view (M1 to M4)", () => {
	it("M1: ticket replaces what shows with that ticket's facts, read again, live, rows closed; the same number again changes nothing", () => {
		every(({prev, msg, next}) => {
			if (msg.type !== "ticket") return;
			if (numberOf(prev) === msg.number) {
				expect(next).toBe(prev);
				return;
			}
			expect(next.shows.kind).toBe("ticket");
			if (next.shows.kind !== "ticket") return;
			expect([next.shows.facts, next.shows.records, next.shows.at]).toEqual([
				{at: "reading", number: msg.number},
				[],
				null,
			]);
			expect([next.open, next.chosen]).toEqual([[], null]);
		});
	});

	it("M2: facts for another ticket, or in the job view, are dropped; its own become what it read", () => {
		every(({prev, msg, next}) => {
			if (msg.type !== "facts") return;
			if (numberOf(prev) !== msg.number) {
				expect(next).toBe(prev);
				return;
			}
			expect(next.shows.kind === "ticket" && next.shows.facts).toEqual({
				at: "read",
				number: msg.number,
				timeline: msg.timeline,
			});
		});
	});

	it("M2: in the ticket view, a record read for an id that is not one of its lanes is dropped", () => {
		every(({prev, msg, next}) => {
			if (msg.type !== "got" || prev.shows.kind !== "ticket") return;
			if (lanesIn(timelineOf(prev) ?? []).includes(msg.trace.trace)) return;
			expect(next).toBe(prev);
		});
	});

	it("M2: a record read for one of its lanes is that lane's record", () => {
		const timeline = TIMELINES[0] ?? [];
		const lane = lanesIn(timeline)[0] ?? "";
		const s = showing(timeline, [{type: "got", trace: record(lane)}]);
		expect(s.shows.kind === "ticket" && s.shows.records.map((r) => [r.id, r.read.at])).toEqual([
			[lane, "read"],
		]);
	});

	it("M3: the facts are read while a ticket shows, and only then", () => {
		every(({next}) => {
			const number = numberOf(next);
			expect(depsOf("facts", next)).toEqual(number === null ? [] : [{number}]);
		});
	});

	it("M3: in the ticket view it follows each lane's record once, every lane its facts name, and nothing else", () => {
		every(({next}) => {
			if (next.shows.kind !== "ticket") return;
			const followed = followedIn(next);
			expect(followed.toSorted()).toEqual([...lanesIn(timelineOf(next) ?? [])].toSorted());
		});
	});

	it("M3: in the ticket view the clock runs only while a lane is open and the playhead is live", () => {
		every(({next}) => {
			if (next.shows.kind !== "ticket") return;
			const on = next.shows.at === null && anyOpen(timelineOf(next) ?? []);
			expect(depsOf("tick", next).length > 0).toBe(on);
		});
	});

	it("M3: in the job view no facts are read and no lane is followed", () => {
		every(({next}) => {
			if (next.shows.kind !== "job") return;
			expect(depsOf("facts", next)).toEqual([]);
			expect(followedIn(next).length).toBeLessThanOrEqual(1);
		});
	});

	it("M4: step +1 from a stop goes to the next stop, and past the last to live", () => {
		for (const timeline of TIMELINES) {
			const stops = stopsOf(timeline);
			stops.forEach((stop, k) => {
				const s = showing(timeline, [
					{type: "seek", at: stop},
					{type: "step", by: 1},
				]);
				expect(atOf(s)).toBe(stops[k + 1] ?? null);
			});
		}
	});

	it("M4: step -1 then step +1 comes back, between the ends", () => {
		for (const timeline of TIMELINES) {
			const stops = stopsOf(timeline);
			stops.slice(1, -1).forEach((stop) => {
				const s = showing(timeline, [
					{type: "seek", at: stop},
					{type: "step", by: -1},
					{type: "step", by: 1},
				]);
				expect(atOf(s)).toBe(stop);
			});
		}
	});

	it("M4: step -1 goes to the stop before", () => {
		for (const timeline of TIMELINES) {
			const stops = stopsOf(timeline);
			stops.slice(1).forEach((stop, k) => {
				const s = showing(timeline, [
					{type: "seek", at: stop},
					{type: "step", by: -1},
				]);
				expect(atOf(s)).toBe(stops[k]);
			});
		}
	});

	it("M4: seek to a stop sits there; seek past the last fact, or to null, is live", () => {
		for (const timeline of TIMELINES) {
			const stops = stopsOf(timeline);
			const last = timeline.at(-1)?.at ?? 0;
			for (const stop of stops)
				expect(atOf(showing(timeline, [{type: "seek", at: stop}]))).toBe(stop);
			expect(atOf(showing(timeline, [{type: "seek", at: last + 1}]))).toBeNull();
			expect(
				atOf(
					showing(timeline, [
						{type: "seek", at: stops[0] ?? 0},
						{type: "seek", at: null},
					]),
				),
			).toBeNull();
		}
	});

	it("M4: seek and step change nothing in the job view", () => {
		every(({prev, msg, next}) => {
			if ((msg.type !== "seek" && msg.type !== "step") || prev.shows.kind !== "job") return;
			expect(next).toEqual(prev);
		});
	});
});

describe("the owner's answer 1: lanes oldest first, only the newest opens", () => {
	it("opens the newest lane alone when the facts first come", () => {
		for (const timeline of TIMELINES) {
			const s = showing(timeline);
			const lanes = s.open.filter((k) => k.startsWith("lane:"));
			expect(lanes).toEqual([`lane:${lanesIn(timeline).at(-1)}`]);
		}
	});
});

describe("the trace machine's model is plain data (docs/direction/saved-state.md, S2)", () => {
	// S2: "a model that holds a function, a Date or a cache would fail it, rightly". Today's version
	// has no sync-test helper (experiment 190's is a script), so this law asks the part every save
	// needs: each state reads back the same through text. A Map, a Set or a class instance does not.
	// Red on e3dc0b85: a lane's read record holds its span index as two Maps.
	it("every state reads back equal through JSON.stringify and JSON.parse", () => {
		every(({next}) => {
			expect(JSON.parse(JSON.stringify(next))).toEqual(next);
		});
	});
});
