import {Job, type Json, jsonPatchOf, type Span, type Step} from "@kampus/fabrika";
import {Schema} from "effect";
import type {Model} from "./machine.ts";
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
]);
export type Detail = typeof Detail.Type;

export const Shown = Schema.Struct({
	read: Schema.Literals(["waiting", "reading", "read", "unread"]),
	/** Why it could not be read. */
	why: Schema.NullOr(Schema.String),
	id: Schema.NullOr(Schema.String),
	/** The job's line, or its root span's name. */
	title: Schema.String,
	job: Schema.NullOr(Job),
	/** The axis: milliseconds from the job's start to its last moment. Never 0. */
	length: Schema.Number,
	/** Every service, in the order first seen: a service's colour is its place here. */
	services: Schema.Array(Schema.String),
	spans: Schema.Int,
	steps: Schema.Int,
	rows: Schema.Array(Row),
	chosen: Schema.NullOr(Detail),
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
		if (op.op === "add") return {op: "add", path: op.path, after: op.value};
		if (op.op === "remove") return {op: "remove", path: op.path, before: at(before, op.path)};
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
		if (isOpen) for (const c of n.children) walk(c, depth + 1);
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

const detailOf = (
	node: Node,
	trace: Extract<Model["read"], {readonly at: "read"}>["trace"],
	zero: number,
): Detail => {
	const record = trace.runs.find((r) => r.run === node.note || `run:${r.run}` === node.key);
	const run =
		record === undefined ? null : {run: record.run, status: record.status, flags: record.flags};
	const job = node.kind === "job" ? trace.job : null;
	const of = node.of;
	switch (of.kind) {
		case "span":
			return {
				kind: "span",
				key: node.key,
				name: of.span.name,
				service: of.span.service,
				span: of.span.span,
				parent: of.span.parent,
				at: of.span.start - zero,
				took: of.span.end - of.span.start,
				status: of.span.status,
				tags: tagsOf(of.span.tags),
				events: of.span.events.map((e) => ({name: e.name, at: e.at - zero, tags: tagsOf(e.tags)})),
				run,
				job,
			};
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
	why: null,
	title: "",
	job: null,
	length: 1,
	services: [],
	spans: 0,
	steps: 0,
	rows: [],
	chosen: null,
} as const;

/** What the window is shown, from the machine's state alone. */
export const shownOf = (s: Model): Shown => {
	switch (s.read.at) {
		case "waiting":
			return {read: "waiting", id: null, ...waiting};
		case "reading":
			return {read: "reading", id: s.read.id, ...waiting};
		case "unread":
			return {read: "unread", id: s.read.id, ...waiting, why: s.read.why};
		case "read": {
			const trace = s.read.trace;
			const root = treeOf(trace);
			const all = nodesOf(root);
			const zero = Math.min(...all.map((n) => n.from));
			const end = Math.max(...all.map((n) => n.to));
			const chosen = s.chosen === null ? undefined : findOf(root, s.chosen);
			const rows = flatten(root, new Set(s.open), zero);
			return {
				read: "read",
				why: null,
				id: trace.trace,
				title: trace.job?.text ?? root.name,
				job: trace.job,
				length: Math.max(1, end - zero),
				services: [...new Set([root.service, ...trace.spans.map((x) => x.service)])],
				spans: trace.spans.length,
				steps: trace.steps.length,
				rows,
				chosen: chosen === undefined ? null : detailOf(chosen, trace, zero),
			};
		}
	}
};
