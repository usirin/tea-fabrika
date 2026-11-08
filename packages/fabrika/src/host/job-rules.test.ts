import {Schema} from "effect";
import {describe, expect, it} from "vitest";
import {callJob, type Heads, KEYFRAME, keepSpans, migrateJob, TABLES} from "./job-rules.ts";
import type {SpanRow} from "./otlp.ts";
import {connect} from "./sqlite-driver.ts";
import {JobCall, RecordRead} from "./traces.ts";

// Record wide (docs/plan/pipeline-self-fix.md, PR 7): a job's record keeps an agent run's content
// in a `content` table beside its spans, keyed by span id, in the shape
// docs/direction/an-agent-run-keeps-its-content.md gives. The span keeps its names and ids; its
// input and output, Langfuse's two tags that tea writes, go to `content`. That table is the one
// part of the record a person can delete, one span at a time: the span stays, and the row says who
// deleted it, when and why. Run on node:sqlite, with the SQL the Durable Object runs.

const INPUT = "langfuse.observation.input";
const OUTPUT = "langfuse.observation.output";

const TOOL = "7f2c00000000000a";
const CHAT = "7f2c00000000000b";

const span = (id: string, name: string, input: string, output: string): SpanRow => ({
	span: id,
	parent: null,
	name,
	service: "build",
	start: id === TOOL ? 812 : 840,
	end: id === TOOL ? 840 : 900,
	status: "ok",
	tags: {"gen_ai.operation.name": name.split(" ")[0] ?? name, [INPUT]: input, [OUTPUT]: output},
	events: [],
});

const tool = span(TOOL, "execute_tool Read", '{"file_path":".env.example"}', '"A=1\\nB=2"');
const chat = span(CHAT, "chat", '{"input":"Build it."}', '{"content":"I read the file."}');

/** A fresh record, its tables made, and one call on it as `by` at `now`. */
const record = () => {
	const {db, close} = connect(":memory:");
	migrateJob(db);
	const heads: Heads = new Map();
	const call = (c: unknown, by = "agent:otel", now = 5000) =>
		// The call PR 7 adds is not in `JobCall` yet: a test written before it names it as data.
		callJob(db, heads, c as JobCall, by, now, KEYFRAME) as {
			readonly spans: readonly SpanRow[];
			readonly content?: readonly unknown[];
		};
	return {db, close, call};
};

const byId = (rows: readonly unknown[] | undefined) =>
	[...(rows ?? [])].sort((a, b) =>
		String((a as {span: string}).span).localeCompare(String((b as {span: string}).span)),
	);

describe("a job's record keeps an agent run's content", () => {
	it("has a content table, so a law that reads every row reads it too", () => {
		expect(TABLES).toContain("content");
	});

	it("moves each span's input and output to `content`, by span id, and keeps the span's other tags", () => {
		const {db, close, call} = record();
		keepSpans(db, [tool, chat], "agent:otel");
		const read = call({op: "read"});
		close();
		expect(byId(read.content)).toEqual([
			{span: TOOL, input: '{"file_path":".env.example"}', output: '"A=1\\nB=2"'},
			{span: CHAT, input: '{"input":"Build it."}', output: '{"content":"I read the file."}'},
		]);
		for (const s of read.spans) {
			expect(s.tags).not.toHaveProperty(INPUT);
			expect(s.tags).not.toHaveProperty(OUTPUT);
			expect(s.tags).toHaveProperty("gen_ai.operation.name");
		}
	});

	it("deletes one span's content: the span stays, its row says who, when and why, and the others are untouched", () => {
		const {db, close, call} = record();
		keepSpans(db, [tool, chat], "agent:otel");
		const before = call({op: "read"});
		call({op: "deleteContent", span: TOOL, why: "a key in .env was read"}, "user:owner", 7000);
		const after = call({op: "read"});
		close();
		expect(after.spans).toEqual(before.spans);
		expect(byId(after.content)).toEqual([
			{span: TOOL, deleted: {by: "user:owner", at: 7000, why: "a key in .env was read"}},
			{span: CHAT, input: '{"input":"Build it."}', output: '{"content":"I read the file."}'},
		]);
	});

	it("keeps deleted content deleted when the exporter sends the span again", () => {
		const {db, close, call} = record();
		keepSpans(db, [tool, chat], "agent:otel");
		call({op: "deleteContent", span: TOOL, why: "a key in .env was read"}, "user:owner", 7000);
		keepSpans(db, [tool], "agent:otel");
		const read = call({op: "read"});
		close();
		expect(byId(read.content)[0]).toEqual({
			span: TOOL,
			deleted: {by: "user:owner", at: 7000, why: "a key in .env was read"},
		});
		expect(JSON.stringify(read)).not.toContain(".env.example");
	});

	it("keeps a span that carried only its input as that input and no output", () => {
		const {db, close, call} = record();
		const {[OUTPUT]: _, ...inputOnly} = tool.tags;
		keepSpans(db, [{...tool, tags: inputOnly}], "agent:otel");
		const read = call({op: "read"});
		close();
		expect(read.content).toEqual([
			{span: TOOL, input: '{"file_path":".env.example"}', output: null},
		]);
	});

	it("refuses an agent that asks to delete content, and keeps it", () => {
		const {db, close, call} = record();
		keepSpans(db, [tool], "agent:otel");
		const refused = call({op: "deleteContent", span: TOOL, why: "a key was read"}, "agent:build");
		const read = call({op: "read"});
		close();
		expect(refused).toEqual({error: "only a person deletes content, and agent:build is not one"});
		expect(read.content).toEqual([
			{span: TOOL, input: '{"file_path":".env.example"}', output: '"A=1\\nB=2"'},
		]);
	});
});

// Who started a job and who stopped it (tracker 185a). A call may name a writer, `began.by` and
// `ended.stop.by`, but the record keeps it only when the sender may name it: the sender itself,
// or, from a person, an agent working for that person. Anyone else: the sender, as the door
// stamped it. This rule is all that stops a sender from forging a job's writer.
//
//   sender user:github:7, began.by agent:claude for:github:7   job.by = the agent
//   sender user:github:7, began.by user:github:8               job.by = user:github:7
//   sender agent:claude for:github:7, began.by user:github:7   job.by = the agent

const PERSON = "user:github:7";
const OWN_AGENT = "agent:claude for:github:7";

/** Each claim a sender makes, and the writer the record keeps for it. */
const CLAIMS = [
	{what: "a person names their own agent", sender: PERSON, claim: OWN_AGENT, kept: OWN_AGENT},
	{what: "a person names another person", sender: PERSON, claim: "user:github:8", kept: PERSON},
	{
		what: "a person names another person's agent",
		sender: PERSON,
		claim: "agent:claude for:github:8",
		kept: PERSON,
	},
	{what: "an agent names its person", sender: OWN_AGENT, claim: PERSON, kept: OWN_AGENT},
] as const;

describe("a job's record keeps only a writer its sender may name", () => {
	for (const {what, sender, claim, kept} of CLAIMS) {
		it(`began: ${what}, and the record keeps ${kept}`, () => {
			const {db, close, call} = record();
			call({op: "began", n: 1, text: "counter", host: "laptop", at: 10, by: claim}, sender);
			const row = db.all(`SELECT by FROM job`)[0];
			close();
			expect(row?.by).toBe(kept);
		});

		it(`ended's stop: ${what}, and the record keeps ${kept}`, () => {
			const {db, close, call} = record();
			call({op: "began", n: 1, text: "counter", host: "laptop", at: 10}, sender);
			call({op: "ended", how: "stopped", at: 20, stop: {by: claim, why: "wrong ticket"}}, sender);
			const row = db.all(`SELECT by, ended_by, why FROM job`)[0];
			close();
			expect(row).toEqual({by: sender, ended_by: kept, why: "wrong ticket"});
		});
	}
});

// Every start of a kept machine run (docs/plan/replay-through-current-code.md, step 1). A `start`
// call is kept as a row of its own table, never replaced: `n` counts the starts of one machine
// run, and `after` is how many of its steps the record held when the start came, which the record
// counts and the writer never says. The state is kept whole, never as a patch. `read` answers them
// beside the steps, by run, machine run and `n`.

const RUN = "tally-5d02c7a1";

/** A `start` call of tally's count total, kept with `state`. */
const startCall = (state: unknown, at = 10, more: Record<string, unknown> = {}) => ({
	op: "start",
	run: RUN,
	program: "tally",
	machine: "count",
	id: "total",
	at,
	state,
	...more,
});

/** A `step` call of tally's count total: `add` folded into `total`. */
const stepCall = (add: number, total: number, at: number) => ({
	op: "step",
	run: RUN,
	machine: "count",
	id: "total",
	at,
	msg: {type: "add", n: add},
	state: {total},
	cmds: [],
});

/** The starts a read answers, as the record keeps them. */
const startsOf = (read: unknown) => (read as {readonly starts: readonly unknown[]}).starts;

describe("a job's record keeps every start of a machine run", () => {
	it("has a starts table, so a law that reads every row reads it too", () => {
		expect(TABLES).toContain("starts");
	});

	it("keeps a start as a row: the program, the machine run, when, its state, and who wrote it", () => {
		const {close, call} = record();
		call(startCall({total: 0}), "user:owner");
		const read = call({op: "read"});
		close();
		expect(startsOf(read)).toEqual([
			{
				run: RUN,
				program: "tally",
				machine: "count",
				id: "total",
				n: 1,
				after: 0,
				at: 10,
				state: {total: 0},
				by: "user:owner",
			},
		]);
	});

	it("counts each machine run's starts 1, 2, 3, and another machine run's from 1", () => {
		const {close, call} = record();
		call(startCall({total: 0}, 10));
		call(startCall({total: 0}, 20));
		call({...startCall({phase: "idle"}, 25), program: "ship", machine: "ship", id: "pr/14"});
		call(startCall({total: 0}, 30));
		const read = call({op: "read"});
		close();
		expect(
			startsOf(read).map((s) => {
				const {machine, id, n} = s as {machine: string; id: string; n: number};
				return [machine, id, n];
			}),
		).toEqual([
			["count", "total", 1],
			["count", "total", 2],
			["count", "total", 3],
			["ship", "pr/14", 1],
		]);
	});

	it("says after how many of the machine run's steps each start came, as the record counted them", () => {
		const {close, call} = record();
		call(startCall({total: 0}, 10));
		call(stepCall(1, 1, 11));
		call(stepCall(2, 3, 12));
		// Another machine run's step is not this one's.
		call({...stepCall(5, 5, 13), id: "other"});
		call(startCall({total: 3}, 20));
		call(stepCall(3, 6, 21));
		call(startCall({total: 6}, 30));
		const read = call({op: "read"});
		close();
		expect(
			startsOf(read).map((s) => {
				const {n, after, state} = s as {n: number; after: number; state: unknown};
				return [n, after, state];
			}),
		).toEqual([
			[1, 0, {total: 0}],
			[2, 2, {total: 3}],
			[3, 3, {total: 6}],
		]);
	});

	it("takes no `after` or `n` from the writer: the record counts them itself", () => {
		const {close, call} = record();
		call(stepCall(1, 1, 11));
		call(startCall({total: 1}, 20, {after: 99, n: 7}));
		const read = call({op: "read"});
		close();
		expect(startsOf(read)).toMatchObject([{n: 1, after: 1}]);
	});

	it("keeps the state whole, never as a patch of the one before", () => {
		const big = {items: Array.from({length: 50}, (_, i) => ({i, name: `item ${i}`})), total: 0};
		const {db, close, call} = record();
		call(startCall(big, 10));
		call(startCall({...big, total: 1}, 20));
		const rows = db.all(`SELECT body FROM starts ORDER BY n`);
		const read = call({op: "read"});
		close();
		expect(rows.map((r) => JSON.parse(String(r.body)))).toEqual([big, {...big, total: 1}]);
		expect(startsOf(read).map((s) => (s as {state: unknown}).state)).toEqual([
			big,
			{...big, total: 1},
		]);
	});

	it("replaces nothing: the same start sent twice is two rows, and the first stays as it was", () => {
		const {db, close, call} = record();
		call(startCall({total: 0}, 10), "user:owner");
		const first = db.all(`SELECT * FROM starts`);
		call(startCall({total: 0}, 10), "user:owner");
		const after = db.all(`SELECT * FROM starts ORDER BY n`);
		close();
		expect(after).toHaveLength(2);
		expect(after[0]).toEqual(first[0]);
		expect(after.map((r) => Number(r.n))).toEqual([1, 2]);
	});

	it("reads an empty record's starts as none", () => {
		const {close, call} = record();
		const read = call({op: "read"});
		close();
		expect(startsOf(read)).toEqual([]);
	});
});

describe("a record read by older code", () => {
	it("decodes with no starts when its read says nothing of them", () => {
		const read = Schema.decodeUnknownSync(RecordRead)({
			job: null,
			runs: [],
			spans: [],
			steps: [],
			opened: [],
			content: [],
		});
		expect(read.starts).toEqual([]);
	});

	it("takes a start call on the wire, and refuses one with no program", () => {
		const call = startCall({total: 0});
		expect(Schema.decodeUnknownExit(JobCall)(call)._tag).toBe("Success");
		const {program: _, ...nameless} = call;
		expect(Schema.decodeUnknownExit(JobCall)(nameless)._tag).toBe("Failure");
	});
});
