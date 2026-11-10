import {describe, expect, it} from "vitest";
import {callJob, type Heads, KEYFRAME, keepSpans, migrateJob, TABLES} from "./job-rules.ts";
import type {SpanRow} from "./otlp.ts";
import {connect} from "./sqlite-driver.ts";
import type {JobCall} from "./traces.ts";

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
