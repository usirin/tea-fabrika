import type {SessionUpdate} from "@agentclientprotocol/sdk/unstable";
import {replay} from "@demlik/tea";
import {describe, expect, it} from "vitest";
import {acpEvents} from "./spans.ts";
import {
	countsOf,
	type Seen,
	saidIn,
	seenOf,
	statusLine,
	type TranscriptMsg,
	transcript,
} from "./transcript.ts";

// The fold, row by row: scripted ACP updates in, the transcript out.

const fold = (msgs: readonly TranscriptMsg[]) => replay(transcript, {msgs, ctx: undefined}).state;
const seen = (...updates: SessionUpdate[]): TranscriptMsg => ({
	type: "seen",
	events: updates.map(seenOf),
});
const chunk = (text: string, messageId?: string): SessionUpdate => ({
	sessionUpdate: "agent_message_chunk",
	content: {type: "text", text},
	...(messageId === undefined ? {} : {messageId}),
});
const OPEN: TranscriptMsg[] = [
	{type: "opening", how: "new", earlier: 0},
	{type: "opened", mode: "auto"},
];
const turn = (n: number, prompt = `prompt ${n}`): TranscriptMsg => ({type: "turn", n, prompt});
const ended = (n: number, stop: "end_turn" | "cancelled" = "end_turn"): TranscriptMsg => ({
	type: "ended",
	ended: {n, stop, usage: {input: 10, output: 2, cached: 0, total: 12}},
});

describe("the transcript fold", () => {
	it("chunks of one message are one message; a new message id starts another", () => {
		const s = fold([
			...OPEN,
			turn(1),
			seen(chunk("The river", "m1"), chunk(" is Kura.", "m1"), chunk("Second.", "m2")),
			ended(1),
		]);
		expect(s.messages.map((m) => [m.who, m.text, m.turn])).toEqual([
			["user", "prompt 1", 1],
			["agent", "The river is Kura.", 1],
			["agent", "Second.", 1],
		]);
		expect(saidIn(s, 1)).toBe("The river is Kura.\n\nSecond.");
	});

	it("tool_call then tool_call_update: one tool, its status moved; an update for an unseen id makes the tool", () => {
		const s = fold([
			...OPEN,
			turn(1),
			seen(
				{
					sessionUpdate: "tool_call",
					toolCallId: "t1",
					title: "Read",
					kind: "read",
					status: "pending",
				},
				{
					sessionUpdate: "tool_call_update",
					toolCallId: "t1",
					status: "in_progress",
					title: "Read a.txt",
				},
				{sessionUpdate: "tool_call_update", toolCallId: "t1", status: "completed"},
				{sessionUpdate: "tool_call_update", toolCallId: "t2", status: "failed"},
			),
			ended(1),
		]);
		expect(s.tools).toEqual([
			{id: "t1", name: "read", title: "Read a.txt", status: "completed", turn: 1},
			{id: "t2", name: "other", title: "", status: "failed", turn: 1},
		]);
	});

	it("a plan is replaced whole; mode, title and the context window follow the last update", () => {
		const s = fold([
			...OPEN,
			turn(1),
			seen(
				{
					sessionUpdate: "plan",
					entries: [{content: "one", priority: "high", status: "pending"}],
				},
				{
					sessionUpdate: "plan",
					entries: [
						{content: "one", priority: "high", status: "completed"},
						{content: "two", priority: "low", status: "in_progress"},
					],
				},
				{sessionUpdate: "current_mode_update", currentModeId: "plan"},
				{sessionUpdate: "session_info_update", title: "Rivers"},
				{
					sessionUpdate: "usage_update",
					used: 100,
					size: 1000,
					cost: {amount: 0.02, currency: "USD"},
				},
				{sessionUpdate: "usage_update", used: 150, size: 1000},
			),
			ended(1),
		]);
		expect(s.plan).toEqual([
			{text: "one", status: "completed"},
			{text: "two", status: "in_progress"},
		]);
		expect([s.mode, s.title]).toEqual(["plan", "Rivers"]);
		// A later update without a cost keeps the cost last said.
		expect(s.context).toEqual({used: 150, size: 1000, cost: 0.02});
	});

	it("thoughts are counted, and their words are not kept", () => {
		const s = fold([
			...OPEN,
			turn(1),
			seen(
				{sessionUpdate: "agent_thought_chunk", content: {type: "text", text: "secret thought"}},
				{sessionUpdate: "agent_thought_chunk", content: {type: "text", text: "another"}},
			),
			ended(1),
		]);
		expect(s.thoughts).toBe(2);
		expect(JSON.stringify(s)).not.toContain("secret thought");
	});

	it("a prompt echoed back in a live turn is not a second message; replayed on load it is the turn's user message", () => {
		const echo: SessionUpdate = {
			sessionUpdate: "user_message_chunk",
			content: {type: "text", text: "hi"},
		};
		const live = fold([...OPEN, turn(1, "hi"), seen(echo), ended(1)]);
		expect(live.messages.filter((m) => m.who === "user")).toHaveLength(1);
		expect(live.other).toEqual({user_echo: 1});

		const loaded = fold([
			{type: "opening", how: "load", earlier: 1},
			seen(echo, chunk("hello", "m1")),
			{type: "opened", mode: null},
		]);
		expect(loaded.messages.map((m) => [m.who, m.text, m.turn])).toEqual([
			["user", "hi", null],
			["agent", "hello", null],
		]);
		expect([loaded.phase, loaded.earlier]).toEqual(["idle", 1]);
	});

	it("cancel: the turn ends cancelled, its open tools fail, its open asks are counted cancelled", () => {
		const s = fold([
			...OPEN,
			turn(1),
			seen({
				sessionUpdate: "tool_call",
				toolCallId: "t1",
				title: "Edit",
				kind: "edit",
				status: "pending",
			}),
			{
				type: "asked",
				ask: {id: "ask-1", tool: "Edit", title: "Edit", kind: "edit", options: ["allow_once"]},
			},
			{type: "cancelling"},
			ended(1, "cancelled"),
		]);
		expect(s.phase).toBe("idle");
		expect(s.tools[0]?.status).toBe("failed");
		expect(s.asks).toEqual([]);
		expect(s.answered).toEqual({allowed: 0, refused: 0, cancelled: 1});
		expect(s.turns.map((t) => t.stop)).toEqual(["cancelled"]);
	});

	it("an ask answered leaves the open asks and is counted by its answer", () => {
		const ask = {id: "ask-1", tool: "Write", title: "Write", kind: "edit", options: ["allow_once"]};
		const s = fold([
			...OPEN,
			turn(1),
			{type: "asked", ask},
			{type: "answered", ask: "ask-1", answer: "refused"},
			// An answer for an ask not open changes nothing.
			{type: "answered", ask: "ask-9", answer: "allowed"},
		]);
		expect(s.asks).toEqual([]);
		expect(s.answered).toEqual({allowed: 0, refused: 1, cancelled: 0});
	});

	it("a harness's own notice is kept apart from what the model said", () => {
		const s = fold([
			...OPEN,
			turn(1),
			seen(
				{sessionUpdate: "notice", severity: "warning", title: "Auto mode unavailable"},
				chunk("hello", "m1"),
			),
		]);
		expect(s.notices).toEqual([{severity: "warning", title: "Auto mode unavailable", turn: 1}]);
		expect(saidIn(s, 1)).toBe("hello");
	});

	it("an update kind the fold does not use is counted by its name", () => {
		const s = fold([
			...OPEN,
			seen({sessionUpdate: "available_commands_update", availableCommands: []}),
		]);
		expect(s.other).toEqual({available_commands_update: 1});
	});

	it("an update kind named as a name every object inherits is counted from 0, like any other", () => {
		const other = (what: string): Seen => ({kind: "other", what});
		const s = fold([
			...OPEN,
			{type: "seen", events: [other("constructor"), other("__proto__"), other("__proto__")]},
		]);
		// Each is an own key with its count, and the record is still a plain one.
		expect(Object.entries(s.other)).toEqual([
			["constructor", 1],
			["__proto__", 2],
		]);
		expect(Object.getPrototypeOf(s.other)).toBe(Object.prototype);
	});

	it("counts and the status line carry no words: only numbers, phases and ids", () => {
		const s = fold([...OPEN, turn(1, "a secret prompt"), seen(chunk("a secret answer", "m1"))]);
		const said = JSON.stringify(countsOf(s)) + statusLine(s);
		expect(said).not.toContain("secret");
		expect(statusLine(s)).toBe("turn 1 · 0 turns · mode auto");
	});
});

describe("one turn as agent events", () => {
	it("a turn with two tools: brain, tools started and settled, turn settled, run done; no title or input", () => {
		const events = acpEvents("s#1");
		const tool = (id: string, status: "pending" | "completed" | "failed"): Seen =>
			status === "pending"
				? {kind: "tool", id, name: "Read", title: "Read /secret/path", status}
				: {kind: "tool_update", id, name: null, title: null, status};
		const all = [
			...events.start(1, "haiku"),
			...events.seen(tool("t1", "pending"), 2),
			...events.seen(tool("t2", "pending"), 3),
			...events.seen(tool("t1", "completed"), 4),
			...events.seen(tool("t2", "failed"), 5),
			...events.end({n: 1, stop: "end_turn", usage: {input: 5, output: 1, cached: 0, total: 6}}, 6),
		];
		expect(all.map((e) => e.type)).toEqual([
			"BrainStarted",
			"ToolStarted",
			"ToolStarted",
			"ToolSettled",
			"ToolFailed",
			"TurnSettled",
			"RunDone",
		]);
		expect(JSON.stringify(all)).not.toContain("secret");
	});

	it("a cancelled turn ends its open tools failed and the run cancelled", () => {
		const events = acpEvents("s#2");
		events.start(1, null);
		events.seen({kind: "tool", id: "t1", name: "Bash", title: "", status: "in_progress"}, 2);
		const end = events.end({n: 2, stop: "cancelled", usage: null}, 3);
		expect(end.map((e) => e.type)).toEqual(["ToolFailed", "TurnSettled", "RunDone"]);
		expect(end.at(-1)).toMatchObject({status: {kind: "cancelled"}});
	});
});
