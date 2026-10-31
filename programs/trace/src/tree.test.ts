import type {JobTrace, Span} from "@kampus/fabrika";
import {describe, expect, it} from "vitest";
import {TALLY_TRACE} from "./tally.ts";
import {groupsOf, type Node, treeOf} from "./tree.ts";

// The tree a job's record makes: what nests under what, and that nothing in the record is left
// without a row.

const shape = (n: Node): unknown =>
	n.children.length === 0
		? `${n.kind} ${n.name}`
		: {[`${n.kind} ${n.name}`]: n.children.map(shape)};

const span = (id: string, parent: string | null, more: Partial<Span> = {}): Span => ({
	span: id.padEnd(16, "0"),
	parent: parent === null ? null : parent.padEnd(16, "0"),
	name: "work",
	service: "lane",
	start: 0,
	end: 10,
	status: "unset",
	tags: {},
	events: [],
	by: "user:owner",
	...more,
});

const empty: JobTrace = {
	trace: "0".repeat(32),
	job: null,
	runs: [],
	spans: [],
	steps: [],
	opened: [],
};

describe("treeOf", () => {
	it("nests seq --to 3 | tally: the line, two runs, tally's machine run and its three steps", () => {
		expect(shape(treeOf(TALLY_TRACE))).toEqual({
			"job seq --to 3 | tally": [
				"run seq",
				{"run tally": [{"machine count total": ["step add 1", "step add 2", "step add 3"]}]},
			],
		});
	});

	it("folds an agent's turns and tool calls into one row under the span they ran in", () => {
		const tree = treeOf({
			...empty,
			spans: [
				span("a", null, {name: "review"}),
				span("b", "a", {name: "chat", start: 1, tags: {"gen_ai.operation.name": "chat"}}),
				span("c", "a", {name: "read", start: 2, tags: {"gen_ai.operation.name": "execute_tool"}}),
				span("d", "a", {name: "chat", start: 3, tags: {"gen_ai.operation.name": "chat"}}),
				span("e", "a", {name: "round 2", start: 4}),
			],
		});
		expect(shape(tree)).toEqual({
			"job review": [{"turns 2 turns": ["span chat", "span read", "span chat"]}, "span round 2"],
		});
		expect(tree.children[0]?.note).toBe("1 tool call");
	});

	it("keeps a span whose parent never came, and a run no span names, each on a row", () => {
		const tree = treeOf({
			...empty,
			runs: [
				{run: "build-r7", status: "failed", flags: {}, closed: [], machines: [], deadLetters: []},
			],
			spans: [span("a", null, {name: "lane"}), span("b", "f", {name: "orphan", start: 2})],
		});
		expect(shape(tree)).toEqual({"job job": ["span lane", "run build", "span orphan"]});
		const run = tree.children.find((c) => c.kind === "run");
		expect([run?.note, run?.run, run?.wrong]).toEqual(["no span", "build-r7", true]);
	});

	it("marks a span with an error status as wrong, and the only grouped rows open", () => {
		const tree = treeOf({
			...empty,
			spans: [span("a", null), span("b", "a", {status: "error", start: 1})],
		});
		expect(tree.children[0]?.wrong).toBe(true);
		expect([...groupsOf(tree)]).toEqual(["job"]);
	});
});
