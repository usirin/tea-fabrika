import {
	Job,
	type JobTrace,
	type Json,
	jsonPatchOf,
	type Span,
	type Step,
} from "@kampus/fabrika-old";
import type {Entry} from "@kampus/pipeline/tickets/ticket";
import {Schema} from "effect";
import {isRunning, type Model, type Read} from "./machine.ts";
import {childrenOf, type Lane, type LaneRow, lanesOf, stopsOf, summaryOf} from "./ticket.ts";
import {findOf, type Kind, type Node, nodesOf, treeOf} from "./tree.ts";

// What the trace's window is shown: the rows that are open, flattened in order with their depth,
// and the chosen row's detail. Elm's `view`, less the HTML: the window only draws it.
//
//   shownOf(model).rows        // after toggle "job", toggle tally, toggle "count total":
//   // [{name: "seq --to 3 | tally", depth: 0}, {name: "seq", depth: 1}, {name: "tally", depth: 1},
//   //  {name: "count total", depth: 2}, {name: "add 1", depth: 3}, {name: "add 2", ...}, ...]
//   shownOf(model).chosen      // after choose "add 2":
//   // {kind: "step", msg: {type: "add", n: 2}, before: {kind: "kept", state: {total: 1}},
//   //  after: {total: 3}, changes: [{op: "replace", path: "/total", before: 1, after: 3}], cmds: []}
//
// Times are milliseconds from the job's start, so the window places bars with no clock of its own.
//
// The ticket view (ticket 141) is `ticket`, and `rows` stays empty there: one section per lane,
// oldest first, each on its own axis, in ms from the lane's start. A step row carries its tokens
// and never a price: dollars are only in a lane's `usd` and the ticket's (the owner's decision 7).
//
//   shownOf(model).ticket?.lanes.map((l) => [l.n, l.open, l.rows.length])
//   // ticket 117 as it first reads: [[1, false, 0], [2, false, 0], [3, true, 1]]

export const RowKind = Schema.Literals(["job", "span", "run", "turns", "machine", "step"]);

/** A moment inside a row: a dot on its bar. */
export const Dot = Schema.Struct({name: Schema.String, at: Schema.Number});

/** One row the window draws. */
export const Row = Schema.Struct({
	key: Schema.String,
	depth: Schema.Int,
	kind: RowKind,
	name: Schema.String,
	note: Schema.String,
	service: Schema.String,
	/** Milliseconds from the job's start. A step's `from` is its `to`. */
	from: Schema.Number,
	to: Schema.Number,
	wrong: Schema.Boolean,
	/** It groups others, so a click or a key opens it. */
	opens: Schema.Boolean,
	open: Schema.Boolean,
	/** How many rows it groups. */
	size: Schema.Int,
	dots: Schema.Array(Dot),
});
export type Row = typeof Row.Type;

/** A tag, as text: OpenTelemetry's values are plain. */
const Tag = Schema.Tuple([Schema.String, Schema.String]);

/** A run, as its storage keeps it: how it last ended and its flags. */
export const RunInfo = Schema.Struct({
	run: Schema.String,
	status: Schema.String,
	flags: Schema.Unknown,
});
export type RunInfo = typeof RunInfo.Type;

/** One change between a step's state before and after: a JSON Patch op with the old value too. */
export const Change = Schema.Union([
	Schema.Struct({op: Schema.Literal("add"), path: Schema.String, after: Schema.Unknown}),
	Schema.Struct({op: Schema.Literal("remove"), path: Schema.String, before: Schema.Unknown}),
	Schema.Struct({
		op: Schema.Literal("replace"),
		path: Schema.String,
		before: Schema.Unknown,
		after: Schema.Unknown,
	}),
]);
export type Change = typeof Change.Type;

/**
 * How a lane's step or wait stands, for its colour and its word: a step still running, a wait
 * still on a person, one a newer lane cut off (it never ended, or was never answered), or how a
 * step ended. Never colour alone: each comes with its word.
 */
export const State = Schema.Literals([
	"running",
	"waiting",
	"cut",
	"done",
	"send",
	"ask",
	"skip",
	"stuck",
]);
export type State = typeof State.Type;

/** How a wait on a person stands: still `waiting`, `done` once answered, `cut` when a newer lane began first. */
export const WaitState = Schema.Literals(["waiting", "done", "cut"]);
type WaitState = typeof WaitState.Type;

/** A step's tokens, as its end says them: never a price (decision 7). */
export const Tokens = Schema.Struct({
	input: Schema.Number,
	cached: Schema.Number,
	output: Schema.Number,
});
export type Tokens = typeof Tokens.Type;

/**
 * A step's price, without the figure: known (in its lane's sum), unknown, none (code), pending
 * (its model's step has not ended yet), or never (it never ended, so it has no tokens to price).
 */
export const Priced = Schema.Literals(["known", "unknown", "none", "pending", "never"]);

/** The chosen row, opened: what Jaeger shows of a span, and Elm's debugger of a step. */
export const Detail = Schema.Union([
	Schema.Struct({
		kind: Schema.Literal("span"),
		key: Schema.String,
		name: Schema.String,
		service: Schema.String,
		span: Schema.String,
		parent: Schema.NullOr(Schema.String),
		/** Milliseconds from the job's start, and how long it took. */
		at: Schema.Number,
		took: Schema.Number,
		status: Schema.Literals(["unset", "ok", "error"]),
		tags: Schema.Array(Tag),
		events: Schema.Array(
			Schema.Struct({name: Schema.String, at: Schema.Number, tags: Schema.Array(Tag)}),
		),
		run: Schema.NullOr(RunInfo),
		/** The job's own facts, on the job's row. */
		job: Schema.NullOr(Job),
	}),
	Schema.Struct({
		kind: Schema.Literal("machine"),
		key: Schema.String,
		run: Schema.String,
		machine: Schema.String,
		id: Schema.String,
		steps: Schema.Int,
		/** Its state after its newest step. */
		state: Schema.Unknown,
	}),
	Schema.Struct({
		kind: Schema.Literal("step"),
		key: Schema.String,
		run: Schema.String,
		machine: Schema.String,
		id: Schema.String,
		n: Schema.Int,
		at: Schema.Number,
		msg: Schema.Unknown,
		/** `start`: the first step, whose state before is the machine's start, which no row keeps. */
		before: Schema.Union([
			Schema.Struct({kind: Schema.Literal("kept"), state: Schema.Unknown}),
			Schema.Struct({kind: Schema.Literal("start")}),
		]),
		after: Schema.Unknown,
		changes: Schema.Array(Change),
		cmds: Schema.Array(Schema.Unknown),
	}),
	Schema.Struct({
		kind: Schema.Literal("group"),
		key: Schema.String,
		name: Schema.String,
		size: Schema.Int,
		run: Schema.NullOr(RunInfo),
		job: Schema.NullOr(Job),
	}),
	/** A lane's step, from the ticket's facts: when, how it ended, what ran it, its tokens. */
	Schema.Struct({
		kind: Schema.Literal("run"),
		key: Schema.String,
		run: Schema.String,
		stage: Schema.String,
		/** Unix ms, and how long; `took` is so far while it runs. */
		at: Schema.Number,
		took: Schema.Number,
		state: State,
		outcome: Schema.String,
		model: Schema.NullOr(Schema.String),
		harness: Schema.NullOr(Schema.String),
		tokens: Schema.NullOr(Tokens),
		priced: Priced,
	}),
	/** A lane's wait on a person: what was asked, and who picked what, when. */
	Schema.Struct({
		kind: Schema.Literal("ask"),
		key: Schema.String,
		ask: Schema.String,
		what: Schema.String,
		/** Unix ms, and how long; `took` is so far while nobody has answered. */
		at: Schema.Number,
		took: Schema.Number,
		pick: Schema.NullOr(Schema.String),
		by: Schema.NullOr(Schema.String),
		state: WaitState,
	}),
]);
export type Detail = typeof Detail.Type;

/** One row of a lane, in ms from the lane's start. */
export const TicketRow = Schema.Union([
	Schema.Struct({
		kind: Schema.Literal("step"),
		key: Schema.String,
		depth: Schema.Int,
		stage: Schema.String,
		run: Schema.String,
		from: Schema.Number,
		to: Schema.Number,
		state: State,
		outcome: Schema.String,
		/** The model that ran it. `null`: code. */
		model: Schema.NullOr(Schema.String),
		/** `null`: no end yet, or code. */
		tokens: Schema.NullOr(Tokens),
		opens: Schema.Boolean,
		open: Schema.Boolean,
	}),
	Schema.Struct({
		kind: Schema.Literal("wait"),
		key: Schema.String,
		depth: Schema.Int,
		what: Schema.String,
		from: Schema.Number,
		to: Schema.Number,
		pick: Schema.NullOr(Schema.String),
		state: WaitState,
	}),
	Schema.Struct({
		kind: Schema.Literal("span"),
		key: Schema.String,
		depth: Schema.Int,
		name: Schema.String,
		service: Schema.String,
		from: Schema.Number,
		to: Schema.Number,
		wrong: Schema.Boolean,
		opens: Schema.Boolean,
		open: Schema.Boolean,
	}),
	/** A span's HTTP client calls, folded into one row: one per call when it opens. */
	Schema.Struct({
		kind: Schema.Literal("calls"),
		key: Schema.String,
		depth: Schema.Int,
		count: Schema.Int,
		from: Schema.Number,
		to: Schema.Number,
		open: Schema.Boolean,
	}),
]);
export type TicketRow = typeof TicketRow.Type;

/** What the lane line and the ticket line say (./ticket.ts `summaryOf`). */
export const Summary = Schema.Struct({
	lanes: Schema.Int,
	steps: Schema.Int,
	waits: Schema.Int,
	waited: Schema.Number,
	usd: Schema.NullOr(Schema.Number),
	unknown: Schema.Int,
});

/** One lane: its line, and its rows while it is open. */
export const LaneShown = Schema.Struct({
	key: Schema.String,
	trace: Schema.String,
	/** Its place, oldest first, from 1. */
	n: Schema.Int,
	/** Its rows show. */
	open: Schema.Boolean,
	/** A lane with no trace id cannot be named, so it shows open, with no fold. */
	opens: Schema.Boolean,
	/** A step not ended, or an ask not answered. */
	live: Schema.Boolean,
	/** It began on a restart: how long after the lane before it ended, and from which stage. */
	restart: Schema.NullOr(Schema.Struct({after: Schema.Number, from: Schema.String})),
	/** Unix ms, and its axis in ms. Never 0. */
	at: Schema.Number,
	length: Schema.Number,
	state: State,
	outcome: Schema.String,
	summary: Summary,
	/** Its record: none to read (no trace id), asked, read, or it could not be read. */
	record: Schema.Literals(["none", "reading", "read", "unread"]),
	/** Its steps and waits on its own axis, for the folded line. */
	bars: Schema.Array(Schema.Struct({from: Schema.Number, to: Schema.Number, state: State})),
	rows: Schema.Array(TicketRow),
});
export type LaneShown = typeof LaneShown.Type;

/** One ticket's lanes, and where the replay stands. */
export const TicketShown = Schema.Struct({
	number: Schema.Int,
	summary: Summary,
	/** The playhead, Unix ms, `null` live; the stop it is on, from 1, of how many. */
	replay: Schema.Struct({
		at: Schema.NullOr(Schema.Number),
		stop: Schema.Int,
		stops: Schema.Int,
	}),
	lanes: Schema.Array(LaneShown),
});
export type TicketShown = typeof TicketShown.Type;

export const Shown = Schema.Struct({
	/** What the tile shows: one job's record, or one ticket's lanes. */
	shows: Schema.Literals(["job", "ticket"]),
	read: Schema.Literals(["waiting", "reading", "read", "unread"]),
	/** Why it could not be read. */
	why: Schema.NullOr(Schema.String),
	id: Schema.NullOr(Schema.String),
	/** The job's line, or its root span's name, or the ticket's title. */
	title: Schema.String,
	job: Schema.NullOr(Job),
	/** Set while the job has not ended. `took`: how long so far, `null` before the first tick. */
	running: Schema.NullOr(Schema.Struct({took: Schema.NullOr(Schema.Number)})),
	/** The axis: milliseconds from the job's start to its last moment, or to now if it runs. Never 0. */
	length: Schema.Number,
	/** Every service, in the order first seen: a service's colour is its place here. */
	services: Schema.Array(Schema.String),
	spans: Schema.Int,
	steps: Schema.Int,
	/** The record holds no run, no span and no step, or none is read yet. */
	empty: Schema.Boolean,
	rows: Schema.Array(Row),
	chosen: Schema.NullOr(Detail),
	/** The ticket view's lanes, once its facts are read. `null`: the job view, or not read yet. */
	ticket: Schema.NullOr(TicketShown),
});
export type Shown = typeof Shown.Type;

/** A pointer's value in `doc` (RFC 6901), or `undefined` where it names nothing. */
const at = (doc: unknown, path: string): unknown =>
	path
		.split("/")
		.slice(1)
		.map((p) => p.replaceAll("~1", "/").replaceAll("~0", "~"))
		.reduce<unknown>(
			(v, part) =>
				typeof v === "object" && v !== null ? (v as Record<string, unknown>)[part] : undefined,
			doc,
		);

/** What changed from `before` to `after`, each op with the value it replaced or removed. */
export const changesOf = (before: unknown, after: unknown): readonly Change[] =>
	jsonPatchOf(before as Json, after as Json).map((op): Change => {
		if (op.op === "add") {
			return {op: "add", path: op.path, after: op.value};
		}

		if (op.op === "remove") {
			return {op: "remove", path: op.path, before: at(before, op.path)};
		}

		return {op: "replace", path: op.path, before: at(before, op.path), after: op.value};
	});

const tagsOf = (tags: Span["tags"]) =>
	Object.entries(tags)
		.map(([k, v]) => [k, String(v)] as const)
		.toSorted(([a], [b]) => a.localeCompare(b));

const flatten = (root: Node, open: ReadonlySet<string>, zero: number): Row[] => {
	const out: Row[] = [];
	const walk = (n: Node, depth: number) => {
		const opens = n.children.length > 0;
		const isOpen = opens && open.has(n.key);
		out.push({
			key: n.key,
			depth,
			kind: n.kind satisfies Kind,
			name: n.name,
			note: n.note,
			service: n.service,
			from: n.from - zero,
			to: n.to - zero,
			wrong: n.wrong,
			opens,
			open: isOpen,
			size: n.children.length,
			dots: n.events.map((e) => ({name: e.name, at: e.at - zero})),
		});

		if (isOpen) {
			for (const c of n.children) {
				walk(c, depth + 1);
			}
		}
	};
	walk(root, 0);
	return out;
};

const stepDetail = (key: string, step: Step, before: Step | null, zero: number): Detail => ({
	kind: "step",
	key,
	run: step.run,
	machine: step.machine,
	id: step.id,
	n: step.n,
	at: step.at - zero,
	msg: step.msg,
	before: before === null ? {kind: "start"} : {kind: "kept", state: before.state},
	after: step.state,
	changes: before === null ? [] : changesOf(before.state, step.state),
	cmds: step.cmds,
});

/** A span opened, Jaeger's way: its tags and events, with the run and the job it belongs to. */
const spanDetail = (
	key: string,
	span: Span,
	run: RunInfo | null,
	job: JobTrace["job"],
	zero: number,
): Detail => ({
	kind: "span",
	key,
	name: span.name,
	service: span.service,
	span: span.span,
	parent: span.parent,
	at: span.start - zero,
	took: span.end - span.start,
	status: span.status,
	tags: tagsOf(span.tags),
	events: span.events.map((e) => ({name: e.name, at: e.at - zero, tags: tagsOf(e.tags)})),
	run,
	job,
});

const detailOf = (
	node: Node,
	trace: Extract<Read, {readonly at: "read"}>["trace"],
	zero: number,
): Detail => {
	const record = trace.runs.find((r) => r.run === node.note || `run:${r.run}` === node.key);
	const run =
		record === undefined ? null : {run: record.run, status: record.status, flags: record.flags};
	const job = node.kind === "job" ? trace.job : null;
	const of = node.of;

	switch (of.kind) {
		case "span":
			return spanDetail(node.key, of.span, run, job, zero);
		case "machine":
			return {
				kind: "machine",
				key: node.key,
				run: of.run,
				machine: of.machine,
				id: of.id,
				steps: of.steps.length,
				state: of.steps.at(-1)?.state ?? null,
			};
		case "step":
			return stepDetail(node.key, of.step, of.before, zero);
		case "group":
			return {kind: "group", key: node.key, name: node.name, size: node.children.length, run, job};
	}
};

const waiting = {
	shows: "job",
	why: null,
	title: "",
	job: null,
	running: null,
	length: 1,
	services: [],
	spans: 0,
	steps: 0,
	empty: true,
	rows: [],
	chosen: null,
	ticket: null,
} as const;

// The ticket view.

type StepRow = Extract<LaneRow, {readonly kind: "step"}>;
type WaitRow = Extract<LaneRow, {readonly kind: "wait"}>;
type Outcome = NonNullable<StepRow["ended"]>["outcome"];

/** A code's words: `checks_red` reads "checks red". */
const words = (code: string): string => code.replaceAll("_", " ");

/** How a step ended, in words, as a lane line says it. */
const outcomeWords = (o: Outcome): string => {
	switch (o.kind) {
		case "done":
			return o.part ? "done, in part" : "done";
		case "send":
			return `sent to ${words(o.to)}: ${words(o.why)}`;
		case "ask":
			return `asked ${words(o.who)}: ${words(o.for)}`;
		case "skip":
			return `skipped: ${words(o.why)}`;
		case "stuck":
			return `stuck: ${words(o.why)}`;
	}
};

/** A step's state and words: how it ended, else running in an open lane, else cut off. */
const stepShown = (row: StepRow, lane: Lane): {readonly state: State; readonly outcome: string} =>
	row.ended !== null
		? {state: row.ended.outcome.kind, outcome: outcomeWords(row.ended.outcome)}
		: lane.open
			? {state: "running", outcome: "running"}
			: {state: "cut", outcome: "never ended"};

/** A wait's state: answered, else waiting in an open lane, else cut off. */
const waitState = (row: WaitRow, lane: Lane): WaitState =>
	row.pick !== null ? "done" : lane.open ? "waiting" : "cut";

/** A step's price, in words: a step a newer lane cut off never has one, as it has no tokens. */
const pricedOf = (row: StepRow, lane: Lane): typeof Priced.Type =>
	row.price.kind === "usd"
		? "known"
		: row.price.kind === "pending" && !lane.open
			? "never"
			: row.price.kind;

/** A lane's state and its words: live, else as its last row was left, else as its last step ended. */
const laneState = (lane: Lane): {readonly state: State; readonly outcome: string} => {
	if (lane.open) {
		return lane.rows.some((r) => r.kind === "wait" && r.pick === null)
			? {state: "waiting", outcome: "waiting on a person"}
			: {state: "running", outcome: "running"};
	}

	const left = lane.rows.at(-1);

	if (left?.kind === "wait" && left.pick === null) {
		return {state: "cut", outcome: "never answered"};
	}

	const last = lane.rows.findLast((r): r is StepRow => r.kind === "step");
	return last === undefined ? {state: "done", outcome: "done"} : stepShown(last, lane);
};

/** The HTTP client spans of a list: OpenTelemetry's `http.request.method` names one. */
const isCall = (s: Span): boolean => s.tags["http.request.method"] !== undefined;

/**
 * The span rows under a step: its spans nested by parent, each span's HTTP calls folded into one
 * `calls` row, which opens to one row per call. The spans are grouped by parent in one pass, in
 * their order, so a step with many calls costs one look at each (ticket 182).
 */
const spanRowsOf = (
	under: readonly Span[],
	open: ReadonlySet<string>,
	zero: number,
	depth: number,
): TicketRow[] => {
	const ids = new Set(under.map((s) => s.span));
	// The top spans: no parent, or a parent that is not under the step.
	const top: Span[] = [];
	const byParent = new Map<string, Span[]>();

	for (const s of under) {
		if (s.parent === null || !ids.has(s.parent)) {
			top.push(s);
			continue;
		}

		const list = byParent.get(s.parent);

		if (list === undefined) {
			byParent.set(s.parent, [s]);
		} else {
			list.push(s);
		}
	}

	const out: TicketRow[] = [];
	const spanRow = (s: Span, d: number) => {
		const kids = byParent.get(s.span) ?? [];
		const key = `span:${s.span}`;
		const isOpen = kids.length > 0 && open.has(key);
		out.push({
			kind: "span",
			key,
			depth: d,
			name: s.name,
			service: s.service,
			from: s.start - zero,
			to: s.end - zero,
			wrong: s.status === "error",
			opens: kids.length > 0,
			open: isOpen,
		});

		if (isOpen) {
			level(kids, d + 1, s.span);
		}
	};
	const level = (spans: readonly Span[], d: number, parent: string | null) => {
		const calls = spans.filter(isCall);

		for (const s of spans) {
			if (!isCall(s) || parent === null) {
				spanRow(s, d);
			}
		}

		if (parent === null || calls.length === 0) {
			return;
		}

		const key = `calls:${parent}`;
		const isOpen = open.has(key);
		// A loop, not `Math.min(...)`: a spread puts every call on the stack.
		let first = Infinity;
		let last = -Infinity;

		for (const c of calls) {
			first = Math.min(first, c.start);
			last = Math.max(last, c.end);
		}

		out.push({
			kind: "calls",
			key,
			depth: d,
			count: calls.length,
			from: first - zero,
			to: last - zero,
			open: isOpen,
		});

		if (isOpen) {
			for (const c of calls) {
				spanRow(c, d + 1);
			}
		}
	};
	// The top spans hang off the step's own span: their calls fold under it.
	level(top, depth, top[0]?.parent ?? null);
	return out;
};

/** A lane's record, as the `follow` Sub last read it. */
const recordOf = (
	shows: Extract<Model["shows"], {readonly kind: "ticket"}>,
	trace: string,
): Read | null => shows.records.find((r) => r.id === trace)?.read ?? null;

/** How a lane's record stands, from how its `Read` does. */
const recordWord: Readonly<Record<Read["at"], LaneShown["record"]>> = {
	waiting: "reading",
	reading: "reading",
	read: "read",
	unread: "unread",
};

/** Each lane shown, oldest first, with the rows of the open ones. */
const lanesShown = (
	s: Model,
	shows: Extract<Model["shows"], {readonly kind: "ticket"}>,
	lanes: readonly Lane[],
): readonly LaneShown[] => {
	const open = new Set(s.open);
	return lanes.map((lane, i): LaneShown => {
		const key = `lane:${lane.trace}`;
		const opens = lane.trace !== "";
		const isOpen = !opens || open.has(key);
		const read = opens ? recordOf(shows, lane.trace) : null;
		const record = read?.at === "read" ? read.trace : null;
		const zero = lane.from;
		const before = lanes[i - 1];
		const rows: TicketRow[] = [];

		if (isOpen) {
			for (const row of lane.rows) {
				if (row.kind === "wait") {
					rows.push({
						kind: "wait",
						key: `ask:${row.ask}`,
						depth: 1,
						what: row.what,
						from: row.from - zero,
						to: row.to - zero,
						pick: row.pick,
						state: waitState(row, lane),
					});
					continue;
				}

				const under = record === null ? [] : childrenOf(record, row.run, row.from, row.to);
				const stepKey = `run:${row.run}`;
				const stepOpen = under.length > 0 && open.has(stepKey);
				rows.push({
					kind: "step",
					key: stepKey,
					depth: 1,
					stage: row.stage,
					run: row.run,
					from: row.from - zero,
					to: row.to - zero,
					...stepShown(row, lane),
					model: row.model,
					tokens:
						row.ended === null || row.model === null
							? null
							: {input: row.ended.input, cached: row.ended.cached ?? 0, output: row.ended.output},
					opens: under.length > 0,
					open: stepOpen,
				});

				if (stepOpen) {
					rows.push(...spanRowsOf(under, open, zero, 2));
				}
			}
		}

		return {
			key,
			trace: lane.trace,
			n: i + 1,
			open: isOpen,
			opens,
			live: lane.open,
			restart:
				lane.restart === null
					? null
					: {
							// Never below 0: a lane before it ends by its own last fact (./ticket.ts).
							after: before === undefined ? 0 : Math.max(0, lane.restart.at - before.to),
							from: lane.restart.from,
						},
			at: lane.from,
			length: Math.max(1, lane.to - lane.from),
			...laneState(lane),
			summary: summaryOf([lane]),
			record: !opens ? "none" : read === null ? "reading" : recordWord[read.at],
			bars: lane.rows.map((r) => ({
				from: r.from - zero,
				to: r.to - zero,
				state: r.kind === "wait" ? waitState(r, lane) : stepShown(r, lane).state,
			})),
			rows,
		};
	});
};

/** The chosen row of the ticket view, opened: a step, a wait, or a span of a lane's record. */
const ticketDetail = (
	shows: Extract<Model["shows"], {readonly kind: "ticket"}>,
	lanes: readonly Lane[],
	chosen: string,
): Detail | null => {
	const [kind, ...rest] = chosen.split(":");
	const id = rest.join(":");

	for (const lane of lanes) {
		for (const row of lane.rows) {
			if (kind === "run" && row.kind === "step" && row.run === id) {
				return {
					kind: "run",
					key: chosen,
					run: row.run,
					stage: row.stage,
					at: row.from,
					took: row.to - row.from,
					...stepShown(row, lane),
					model: row.model,
					harness: row.harness,
					tokens:
						row.ended === null
							? null
							: {input: row.ended.input, cached: row.ended.cached ?? 0, output: row.ended.output},
					priced: pricedOf(row, lane),
				};
			}

			if (kind === "ask" && row.kind === "wait" && row.ask === id) {
				return {
					kind: "ask",
					key: chosen,
					ask: row.ask,
					what: row.what,
					at: row.from,
					took: row.to - row.from,
					pick: row.pick,
					by: row.by,
					state: waitState(row, lane),
				};
			}
		}
	}

	if (kind !== "span") {
		return null;
	}

	for (const lane of lanes) {
		const read = recordOf(shows, lane.trace);

		if (read?.at !== "read") {
			continue;
		}

		const span = read.trace.spans.find((sp) => sp.span === id);

		if (span !== undefined) {
			return spanDetail(chosen, span, null, null, lane.from);
		}
	}

	return null;
};

/** The ticket's title, as it was filed. */
const titleOf = (timeline: readonly Entry[], number: number): string => {
	for (const e of timeline) {
		if (e.fact.type === "filed") {
			return e.fact.title;
		}
	}

	return `ticket ${number}`;
};

/** The ticket view, from the machine's state alone. */
const ticketShownOf = (
	s: Model,
	shows: Extract<Model["shows"], {readonly kind: "ticket"}>,
): Shown => {
	const {facts} = shows;
	const base = {...waiting, shows: "ticket", id: null, title: `ticket ${facts.number}`} as const;

	if (facts.at === "reading") {
		return {...base, read: "reading"};
	}

	if (facts.at === "unread") {
		return {...base, read: "unread", why: facts.why};
	}

	const {timeline} = facts;
	// Live, an open row runs to the latest tick, or to the newest fact before the first tick.
	const newest = timeline.at(-1)?.at ?? 0;
	const now = shows.at ?? Math.max(shows.now ?? newest, newest);
	const lanes = lanesOf(timeline, now, shows.at ?? Infinity);
	const stops = stopsOf(timeline);
	const playhead = shows.at;
	return {
		...base,
		read: "read",
		title: titleOf(timeline, facts.number),
		empty: lanes.length === 0,
		chosen: s.chosen === null ? null : ticketDetail(shows, lanes, s.chosen),
		ticket: {
			number: facts.number,
			summary: summaryOf(lanes),
			replay: {
				at: playhead,
				stop: playhead === null ? stops.length : stops.filter((t) => t <= playhead).length,
				stops: stops.length,
			},
			lanes: lanesShown(s, shows, lanes),
		},
	};
};

/** What the window is shown, from the machine's state alone. */
export const shownOf = (s: Model): Shown => {
	if (s.shows.kind === "ticket") {
		return ticketShownOf(s, s.shows);
	}

	const read = s.shows.read;

	switch (read.at) {
		case "waiting":
			return {read: "waiting", id: null, ...waiting};
		case "reading":
			return {read: "reading", id: read.id, ...waiting};
		case "unread":
			return {read: "unread", id: read.id, ...waiting, why: read.why};
		case "read": {
			const trace = read.trace;
			const tree = treeOf(trace);
			const {now} = read;
			// While the job runs its row runs to now, and the axis with it.
			const root = now === null ? tree : {...tree, to: Math.max(tree.to, now)};
			const all = nodesOf(root);
			const zero = Math.min(...all.map((n) => n.from));
			const end = Math.max(...all.map((n) => n.to));
			const length = Math.max(1, end - zero);
			const chosen = s.chosen === null ? undefined : findOf(root, s.chosen);
			const rows = flatten(root, new Set(s.open), zero);
			return {
				shows: "job",
				read: "read",
				why: null,
				id: trace.trace,
				title: trace.job?.text ?? root.name,
				job: trace.job,
				running: isRunning(trace) ? {took: now === null ? null : length} : null,
				length,
				services: [...new Set(all.map((n) => n.service))],
				spans: trace.spans.length,
				steps: trace.steps.length,
				empty: trace.runs.length + trace.spans.length + trace.steps.length === 0,
				rows,
				chosen: chosen === undefined ? null : detailOf(chosen, trace, zero),
				ticket: null,
			};
		}
	}
};
