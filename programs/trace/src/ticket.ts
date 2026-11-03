import type {JobTrace, Span} from "@kampus/fabrika-old";
import {listUsdOf} from "@kampus/pipeline/stages/price";
import type {Entry, FactOf} from "@kampus/pipeline/tickets/ticket";

// One ticket's lanes, folded from its facts: the fold the view and the laws share (ticket 141).
// Today's version. Pure.
//
//   lanesOf(T117, now, Infinity).map((l) => [l.rows.length, l.open])   // [[7, false], [5, false], [1, false]]
//   lanesOf(T117, now, PLAN8_STARTED + 180_000).at(-1)?.rows.at(-1)
//   // {kind: "step", run: "r-plan-8", to: upTo, ended: null}
//
// A lane is one trace id, as its `started` facts give it, oldest first. A `restarted` belongs to
// the next lane that begins after it. An ask sits in the lane its `trace` names, else in the lane
// that last started a step before it. A lane's axis is its own facts only: a `filed` or a
// `commented` days away never moves it. Once a newer lane starts, an older lane is over: what it
// left open never ended, and it ends at its own last fact. Replay is truncation: up to `upTo` is the facts up to
// `upTo`, at `upTo`, as Elm's debugger replays a history.

/** A step's end, as the ticket holds it. */
export type Ended = FactOf<"ended">;

/**
 * A step's price, in four cases: a known price in dollars, a model with no known price, a step that
 * ran no model (code), or a step with a model that has not ended, so its tokens are not known yet.
 * Never a 0 standing in for unknown, and a step still running is never "no list price".
 */
export type Price =
	| {readonly kind: "usd"; readonly usd: number}
	| {readonly kind: "unknown"}
	| {readonly kind: "none"}
	| {readonly kind: "pending"};

/** One row of a lane: a step it ran, or a wait on a person. */
export type LaneRow =
	| {
			readonly kind: "step";
			readonly run: string;
			readonly stage: string;
			readonly from: number;
			readonly to: number;
			readonly ended: Ended | null;
			readonly model: string | null;
			readonly harness: string | null;
			readonly price: Price;
	  }
	| {
			readonly kind: "wait";
			readonly ask: string;
			readonly what: string;
			readonly from: number;
			readonly to: number;
			readonly pick: string | null;
			readonly by: string | null;
	  };

/** One lane: the facts of one trace id, on its own time axis. */
export type Lane = {
	readonly trace: string;
	readonly restart: {readonly at: number; readonly from: string} | null;
	/** The restart's at, else its first started's at. */
	readonly from: number;
	/** Its last ended or answered, or now while open. A lane a newer one followed: its last fact. */
	readonly to: number;
	readonly rows: readonly LaneRow[];
	/** A step not ended or an ask not answered, and no newer lane after it. */
	readonly open: boolean;
};

/** The kinds of fact a replay stops at. */
const STOPS: ReadonlySet<string> = new Set(["started", "ended", "asked", "answered", "restarted"]);

/**
 * A step's price from what its end says: a list price written, else one the tokens give, else what
 * claude billed. A step with no model is code. A step not ended has no price yet.
 */
const priceOf = (model: string | null, harness: string | null, ended: Ended | null): Price => {
	if (model === null) return {kind: "none"};
	if (ended === null) return {kind: "pending"};
	if (typeof ended.listUsd === "number") return {kind: "usd", usd: ended.listUsd};
	const derived = listUsdOf(model, {
		input: ended.input,
		cached: ended.cached ?? 0,
		output: ended.output,
	});
	if (derived !== null) return {kind: "usd", usd: derived};
	if (harness === "claude" && typeof ended.billed === "number")
		return {kind: "usd", usd: ended.billed};
	return {kind: "unknown"};
};

/** A lane as it is folded: its rows, in time order, before their ends are known. */
interface Building {
	readonly trace: string;
	readonly restart: {readonly at: number; readonly from: string} | null;
	/** When each of its steps started. */
	readonly starts: number[];
	/** Each row, by place: a step by its run, or an ask with its fact and time. */
	readonly rows: (
		| {readonly kind: "step"; readonly started: FactOf<"started">; readonly at: number}
		| {readonly kind: "wait"; readonly asked: FactOf<"asked">; readonly at: number}
	)[];
}

/** A ticket's lanes, from its facts up to `upTo`, with `now` for what is still open. */
export const lanesOf = (timeline: readonly Entry[], now: number, upTo: number): readonly Lane[] => {
	const clock = Math.min(now, upTo);
	const seen = timeline.filter((e) => e.at <= upTo);
	const ends = new Map<string, {readonly at: number; readonly fact: Ended}>();
	const answers = new Map<
		string,
		{readonly at: number; readonly pick: string; readonly by: string}
	>();
	for (const e of seen) {
		if (e.fact.type === "ended" && !ends.has(e.fact.run))
			ends.set(e.fact.run, {at: e.at, fact: e.fact});
		if (e.fact.type === "answered" && !answers.has(e.fact.ask))
			answers.set(e.fact.ask, {at: e.at, pick: e.fact.pick, by: e.by.id});
	}

	const lanes: Building[] = [];
	const byTrace = new Map<string, Building>();
	let restart: {readonly at: number; readonly from: string} | null = null;
	let running: Building | null = null;
	for (const e of seen) {
		const {fact} = e;
		if (fact.type === "restarted") restart = {at: e.at, from: fact.from};
		if (fact.type === "started") {
			const trace = fact.trace ?? "";
			let lane = byTrace.get(trace);
			if (lane === undefined) {
				lane = {trace, restart, starts: [], rows: []};
				restart = null;
				lanes.push(lane);
				byTrace.set(trace, lane);
			}
			lane.starts.push(e.at);
			lane.rows.push({kind: "step", started: fact, at: e.at});
			running = lane;
		}
		if (fact.type === "asked") {
			const named = fact.trace === undefined ? undefined : byTrace.get(fact.trace);
			(named ?? running)?.rows.push({kind: "wait", asked: fact, at: e.at});
		}
	}

	return lanes.map((lane, i): Lane => {
		// A newer lane began, so this one is over: a step it left running never ended, and an ask it
		// left open was never answered. Each ends where it began, as nothing later is known of it, so
		// the lane ends at its own last fact and never grows with now.
		const over = i < lanes.length - 1;
		const rows = lane.rows.map((row): LaneRow => {
			if (row.kind === "wait") {
				const answer = answers.get(row.asked.ask) ?? null;
				return {
					kind: "wait",
					ask: row.asked.ask,
					what: row.asked.what,
					from: row.at,
					to: answer?.at ?? (over ? row.at : clock),
					pick: answer?.pick ?? null,
					by: answer?.by ?? null,
				};
			}
			const {started} = row;
			const end = ends.get(started.run) ?? null;
			const model = started.model ?? end?.fact.model ?? null;
			const harness = started.harness ?? end?.fact.harness ?? null;
			return {
				kind: "step",
				run: started.run,
				stage: started.stage,
				from: row.at,
				to: end?.at ?? (over ? row.at : clock),
				ended: end?.fact ?? null,
				model,
				harness,
				price: priceOf(model, harness, end?.fact ?? null),
			};
		});
		const open =
			!over && rows.some((r) => (r.kind === "step" ? r.ended === null : r.pick === null));
		const last = Math.max(...rows.map((r) => r.to));
		return {
			trace: lane.trace,
			restart: lane.restart,
			from: lane.restart?.at ?? lane.starts[0] ?? clock,
			to: open ? clock : last,
			rows,
			open,
		};
	});
};

/** The times a replay stops at: each started, ended, asked, answered and restarted, in order. */
export const stopsOf = (timeline: readonly Entry[]): readonly number[] =>
	timeline.filter((e) => STOPS.has(e.fact.type)).map((e) => e.at);

/** The span "run a step" ends tagged with, naming its run (packages/pipeline/src/stages/traced.ts). */
const RUN_TAG = "tea.lane.run";
const STEP_SPAN = "run a step";

/** How long two spans of time share. */
const overlap = (a: number, b: number, from: number, to: number): number =>
	Math.max(0, Math.min(b, to) - Math.max(a, from));

/**
 * The spans under one step, from its lane's job record: by `tea.lane.run` when the span has it,
 * else the "run a step" span that overlaps [from, to] most. Every span under it, in start order;
 * the step's own span is the step row, so it is not one of them.
 */
export const childrenOf = (
	record: JobTrace,
	run: string,
	from: number,
	to: number,
): readonly Span[] => {
	const tagged = record.spans.find((s) => s.tags[RUN_TAG] === run);
	const root =
		tagged ??
		record.spans
			.filter((s) => s.name === STEP_SPAN && s.tags[RUN_TAG] === undefined)
			.map((s) => ({s, shared: overlap(s.start, s.end, from, to)}))
			.filter((x) => x.shared > 0)
			.toSorted((a, b) => b.shared - a.shared)[0]?.s;
	if (root === undefined) return [];
	const under = new Map<string, Span[]>();
	for (const s of record.spans)
		if (s.parent !== null) under.set(s.parent, [...(under.get(s.parent) ?? []), s]);
	const out: Span[] = [];
	const walk = (id: string) => {
		for (const child of under.get(id) ?? []) {
			out.push(child);
			walk(child.span);
		}
	};
	walk(root.span);
	return out.toSorted((a, b) => a.start - b.start);
};

/**
 * What the lane line and the ticket line say. `usd`: the sum of the `usd` rows, `null` when no row
 * has a known price, so nothing reads as $0.00. `waited`: ms of the wait rows.
 */
export type Summary = {
	readonly lanes: number;
	readonly steps: number;
	readonly waits: number;
	readonly waited: number;
	readonly usd: number | null;
	readonly unknown: number;
};

/** The summary of some lanes: one lane's line, or the whole ticket's. */
export const summaryOf = (lanes: readonly Lane[]): Summary => {
	const rows = lanes.flatMap((l) => l.rows);
	const steps = rows.flatMap((r) => (r.kind === "step" ? [r] : []));
	const waits = rows.flatMap((r) => (r.kind === "wait" ? [r] : []));
	const usd = steps.flatMap((r) => (r.price.kind === "usd" ? [r.price.usd] : []));
	return {
		lanes: lanes.length,
		steps: steps.length,
		waits: waits.length,
		waited: waits.reduce((sum, w) => sum + (w.to - w.from), 0),
		usd: usd.length === 0 ? null : usd.reduce((sum, u) => sum + u, 0),
		unknown: steps.filter((r) => r.price.kind === "unknown").length,
	};
};
