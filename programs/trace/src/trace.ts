import type {Entry, Fact} from "@kampus/pipeline/tickets/ticket";
import {STEPS, type StepName} from "@tea-fabrika/tracker";

// One ticket's facts laid out in time, as a music editor lays out a song: a track per step, a
// clip per run from its `started` to its `ended`, the approval's waits on a person as stripes,
// and the person's answers as markers on the ruler. Pure: the window calls it on every move of
// the playhead, with `upTo` the playhead's time, so what it draws is the facts up to then.
//
//   traceOf(timeline, now)            // live: every fact, open runs end at now
//   // {from: 10:02, to: 10:14, usd: 0.49, tracks: [{name: "ticket", ...},
//   //   {name: "triage", who: "agent", usd: 0.11, clips: [{run: "r-1", from: 10:02, to: 10:03,
//   //     open: false, ended: {outcome: {kind: "send", ...}, usd: 0.11, turns: 1, ...}}]},
//   //   {name: "approval", who: "person", waits: [{ask: "a-1", from: 10:09, to: 10:14, pick: null}]}, ...]}
//   traceOf(timeline, now, 10:05)     // the same axis; plan's run is open, nothing after it shows
//
// The axis is the whole ticket's, whatever `upTo` is, so moving the playhead moves nothing else.

type Ended = Extract<Fact, {readonly type: "ended"}>;

/** One run: from its `started` to its `ended`, or to the playhead while it has none. */
export interface Clip {
	readonly run: string;
	readonly task: string | null;
	readonly from: number;
	readonly to: number;
	/** No `ended` up to the playhead. */
	readonly open: boolean;
	readonly ended: Ended | null;
}

/** One ask on the approval's track: from its `asked` to its `answered`, or to the playhead. */
export interface Wait {
	readonly ask: string;
	readonly what: string;
	readonly from: number;
	readonly to: number;
	/** The pick it was answered with. `null`: no answer up to the playhead. */
	readonly pick: string | null;
}

/** A person's answer, or a comment asking for changes: a marker on the ruler. */
export interface Marker {
	readonly at: number;
	readonly kind: "answer" | "changes";
	/** The pick, for an answer. */
	readonly says: string;
}

/**
 * Who works a track. `agent`: one of its runs took turns. `code`: its runs took none. `person`:
 * the approval. `none`: nothing ran on it yet. `ticket`: the row of the whole ticket.
 */
export type Who = "agent" | "code" | "person" | "none" | "ticket";

export interface Track {
	/** A step's name, `ticket` for the row of the whole ticket, or a stage outside the nine. */
	readonly name: StepName | "ticket" | (string & {});
	readonly who: Who;
	readonly clips: readonly Clip[];
	readonly waits: readonly Wait[];
	/** What its ended runs cost, up to the playhead. */
	readonly usd: number;
}

export interface Trace {
	/** The axis: the first fact's time, and the last's, or now while anything is open. */
	readonly from: number;
	readonly to: number;
	/** The playhead: facts after it are left out. */
	readonly upTo: number;
	readonly tracks: readonly Track[];
	readonly markers: readonly Marker[];
	readonly usd: number;
	/** How many runs, up to the playhead. */
	readonly spans: number;
}

/** The shortest axis: five minutes, so one fact does not fill the whole width. */
const LEAST = 5 * 60 * 1000;

const isOpen = (timeline: readonly Entry[]): boolean => {
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

/** The axis of a whole timeline: from its first fact to its last, or to `now` while one is open. */
export const axisOf = (
	timeline: readonly Entry[],
	now: number,
): {readonly from: number; readonly to: number} => {
	const first = timeline[0]?.at ?? now;
	const last = timeline.at(-1)?.at ?? now;
	const to = isOpen(timeline) ? Math.max(now, last) : last;
	return {from: first, to: Math.max(to, first + LEAST)};
};

const clipsOf = (stage: string, seen: readonly Entry[], upTo: number): Clip[] =>
	seen.flatMap((e) => {
		if (e.fact.type !== "started" || e.fact.stage !== stage) return [];
		const run = e.fact.run;
		const end = seen.find((g) => g.fact.type === "ended" && g.fact.run === run);
		const ended = end?.fact.type === "ended" ? end.fact : null;
		return [
			{
				run,
				task: e.fact.task,
				from: e.at,
				to: end === undefined ? upTo : end.at,
				open: end === undefined,
				ended,
			},
		];
	});

const whoOf = (clips: readonly Clip[]): Who => {
	if (clips.length === 0) return "none";
	return clips.some((c) => (c.ended?.turns ?? 0) > 0) ? "agent" : "code";
};

const usdOf = (clips: readonly Clip[]): number =>
	clips.reduce((sum, c) => sum + (c.ended?.usd ?? 0), 0);

const waitsOf = (seen: readonly Entry[], upTo: number): Wait[] =>
	seen.flatMap((e) => {
		if (e.fact.type !== "asked" || !e.fact.picks.includes("approve")) return [];
		const ask = e.fact.ask;
		const answer = seen.find((g) => g.fact.type === "answered" && g.fact.ask === ask);
		return [
			{
				ask,
				what: e.fact.what,
				from: e.at,
				to: answer === undefined ? upTo : answer.at,
				pick: answer?.fact.type === "answered" ? answer.fact.pick : null,
			},
		];
	});

const markersOf = (seen: readonly Entry[]): Marker[] =>
	seen.flatMap((e): Marker[] => {
		if (e.fact.type === "answered") return [{at: e.at, kind: "answer", says: e.fact.pick}];
		if (e.fact.type === "commented" && e.fact.asks === "changes")
			return [{at: e.at, kind: "changes", says: "request changes"}];
		return [];
	});

/** The trace of a timeline at `now`, with the facts up to `upTo` (the playhead; `now` when live). */
export const traceOf = (timeline: readonly Entry[], now: number, upTo: number = now): Trace => {
	const axis = axisOf(timeline, now);
	const head = Math.min(Math.max(upTo, axis.from), axis.to);
	const seen = timeline.filter((e) => e.at <= head);
	const stages = [
		...new Set(seen.flatMap((e) => (e.fact.type === "started" ? [e.fact.stage] : []))),
	];
	const others = stages.filter((s) => !(STEPS as readonly string[]).includes(s));
	const steps: Track[] = [...STEPS, ...others].map((name) => {
		if (name === "approval")
			return {name, who: "person", clips: [], waits: waitsOf(seen, head), usd: 0};
		const clips = clipsOf(name, seen, head);
		return {name, who: whoOf(clips), clips, waits: [], usd: usdOf(clips)};
	});
	const usd = steps.reduce((sum, t) => sum + t.usd, 0);
	const filed = seen[0];
	const ticket: Track = {
		name: "ticket",
		who: "ticket",
		clips:
			filed === undefined
				? []
				: [
						{
							run: "ticket",
							task: null,
							from: filed.at,
							to: isOpen(seen) ? head : (seen.at(-1)?.at ?? head),
							open: isOpen(seen),
							ended: null,
						},
					],
		waits: [],
		usd,
	};
	return {
		from: axis.from,
		to: axis.to,
		upTo: head,
		tracks: [ticket, ...steps],
		markers: markersOf(seen),
		usd,
		spans: steps.reduce((n, t) => n + t.clips.length, 0),
	};
};

/** Where a time sits on the axis, from 0 to 100. */
export const placeOf = (trace: Pick<Trace, "from" | "to">, at: number): number =>
	((at - trace.from) / (trace.to - trace.from)) * 100;

/** The ruler's ticks: a round step that gives about six of them. */
export const ticksOf = (trace: Pick<Trace, "from" | "to">): readonly number[] => {
	const minute = 60 * 1000;
	const span = trace.to - trace.from;
	const step =
		[1, 2, 5, 10, 15, 30, 60, 120, 360, 720, 1440]
			.map((m) => m * minute)
			.find((s) => span / s <= 8) ?? 1440 * minute;
	const out: number[] = [];
	for (let t = Math.ceil(trace.from / step) * step; t <= trace.to; t += step) out.push(t);
	return out;
};

/** The times the playhead stops at with the arrow keys: each fact's, oldest first. */
export const stopsOf = (timeline: readonly Entry[]): readonly number[] => [
	...new Set(timeline.map((e) => e.at)),
];
