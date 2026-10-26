import type {SessionUpdate} from "@agentclientprotocol/sdk";
import {defineMachine} from "@demlik/tea";
import {Schema} from "effect";

// What one ACP session shows a person: its transcript, folded from the
// harness's `session/update` events. Plain Elm: events in, state out. No Cmd,
// no clock, no I/O. ACP streams deltas (a chunk of a message, one change to a
// tool call), never a snapshot, so the fold is where the snapshot is made.
//
//   seen [said agent "The river"]        messages: [... {who: "agent", text: "The river"}]
//   seen [said agent " is Kura."]        the same message, longer
//   seen [tool t1 Read pending]          tools: [{id: "t1", status: "pending"}]
//   seen [tool_update t1 completed]      tools: [{id: "t1", status: "completed"}]
//   ended {n: 1, stop: "end_turn"}       turns: [{n: 1, stop: "end_turn", usage}]
//
// An ACP update is turned into one of our own events first (`seenOf`), so
// the machine knows our words and not the SDK's types. An update kind the
// fold does not use is counted by its name in `other`, never dropped silently.
//
// Thoughts are counted, never kept: what a model thinks is not shown.
//
// The transcript is not kept in storage. A session started again with
// `session/load` gets it back from the harness's replay; one started with
// `session/resume` gets nothing back, and shows only what came after, with
// `earlier` saying how many turns came before.

/** How the session was opened at this start. */
export const How = Schema.Literals(["new", "load", "resume"]);
export type How = typeof How.Type;

export const ToolStatus = Schema.Literals(["pending", "in_progress", "completed", "failed"]);
export type ToolStatus = typeof ToolStatus.Type;

/** A count: a whole number, 0 or more. */
const Count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
/** A turn of this start, or `null`: from before it. */
const TurnOf = Schema.NullOr(Schema.Finite);

/** One ACP update, in our words. */
export type Seen =
	| {
			readonly kind: "said";
			readonly who: "user" | "agent";
			readonly text: string;
			readonly id: string | null;
	  }
	| {readonly kind: "thought"}
	| {
			readonly kind: "tool";
			readonly id: string;
			readonly name: string;
			readonly title: string;
			readonly status: ToolStatus;
	  }
	| {
			readonly kind: "tool_update";
			readonly id: string;
			readonly name: string | null;
			readonly title: string | null;
			readonly status: ToolStatus | null;
	  }
	| {readonly kind: "plan"; readonly entries: readonly Step[]}
	| {readonly kind: "mode"; readonly id: string}
	| {readonly kind: "title"; readonly title: string}
	| {
			readonly kind: "context";
			readonly used: number;
			readonly size: number;
			readonly cost: number | null;
	  }
	| {readonly kind: "notice"; readonly severity: string; readonly title: string}
	| {readonly kind: "other"; readonly what: string};

/** Something the harness itself says, not the model: a fallback, a warning. */
export const Notice = Schema.Struct({
	severity: Schema.String,
	title: Schema.String,
	turn: TurnOf,
});
export type Notice = typeof Notice.Type;

export const Step = Schema.Struct({text: Schema.String, status: Schema.String});
export type Step = typeof Step.Type;

export const Message = Schema.Struct({
	who: Schema.Literals(["user", "agent"]),
	text: Schema.String,
	/** The harness's message id, when it gives one. */
	id: Schema.NullOr(Schema.String),
	/** The turn of this start it came in. `null`: replayed from before. */
	turn: TurnOf,
});
export type Message = typeof Message.Type;

export const Tool = Schema.Struct({
	id: Schema.String,
	/** The tool's own name (`Read`, `exec_command`), or its ACP kind when the harness gives none. */
	name: Schema.String,
	title: Schema.String,
	status: ToolStatus,
	turn: TurnOf,
});
export type Tool = typeof Tool.Type;

/** Tokens, as ACP's `PromptResponse.usage` gives them. */
export const Usage = Schema.Struct({
	input: Schema.Finite,
	output: Schema.Finite,
	cached: Schema.Finite,
	total: Schema.Finite,
});
export type Usage = typeof Usage.Type;

export const Stop = Schema.Literals([
	"end_turn",
	"max_tokens",
	"max_turn_requests",
	"refusal",
	"cancelled",
]);
export type Stop = typeof Stop.Type;

export const Ended = Schema.Struct({n: Schema.Finite, stop: Stop, usage: Schema.NullOr(Usage)});
export type Ended = typeof Ended.Type;

/** A permission ask, as the harness put it. Its option ids are the harness's own. */
export const Ask = Schema.Struct({
	id: Schema.String,
	tool: Schema.String,
	title: Schema.String,
	kind: Schema.String,
	/** The kinds of the options offered: allow_once, reject_once, ... */
	options: Schema.Array(Schema.String),
});
export type Ask = typeof Ask.Type;

export const Answer = Schema.Literals(["allowed", "refused", "cancelled"]);
export type Answer = typeof Answer.Type;

export const Phase = Schema.Literals(["starting", "loading", "idle", "turn", "cancelling"]);
export type Phase = typeof Phase.Type;

/** The transcript: the machine's state, and its schema. */
export const Transcript = Schema.Struct({
	phase: Phase,
	how: Schema.NullOr(How),
	/** Turns ended before this start: what a resumed session cannot show. */
	earlier: Count,
	/** The turn running now. */
	turn: Schema.NullOr(Schema.Finite),
	messages: Schema.Array(Message),
	thoughts: Count,
	tools: Schema.Array(Tool),
	plan: Schema.Array(Step),
	mode: Schema.NullOr(Schema.String),
	title: Schema.NullOr(Schema.String),
	/** The context window: tokens used of its size, and the session's cost so far when the harness says it. */
	context: Schema.NullOr(
		Schema.Struct({
			used: Schema.Finite,
			size: Schema.Finite,
			cost: Schema.NullOr(Schema.Finite),
		}),
	),
	/** What the harness said of its own, apart from the model's words. */
	notices: Schema.Array(Notice),
	turns: Schema.Array(Ended),
	/** Asks not answered yet. */
	asks: Schema.Array(Ask),
	answered: Schema.Struct({allowed: Count, refused: Count, cancelled: Count}),
	/** Updates the fold does not use, counted by kind. */
	other: Schema.Record(Schema.String, Count),
});
export type Transcript = typeof Transcript.Type;

export const EMPTY: Transcript = {
	phase: "starting",
	how: null,
	earlier: 0,
	turn: null,
	messages: [],
	thoughts: 0,
	tools: [],
	plan: [],
	mode: null,
	title: null,
	context: null,
	notices: [],
	turns: [],
	asks: [],
	answered: {allowed: 0, refused: 0, cancelled: 0},
	other: {},
};

export type TranscriptMsg =
	| {readonly type: "opening"; readonly how: How; readonly earlier: number}
	| {readonly type: "opened"; readonly mode: string | null}
	| {readonly type: "seen"; readonly events: readonly Seen[]}
	| {readonly type: "turn"; readonly n: number; readonly prompt: string}
	| {readonly type: "ended"; readonly ended: Ended}
	| {readonly type: "asked"; readonly ask: Ask}
	| {readonly type: "answered"; readonly ask: string; readonly answer: Answer}
	| {readonly type: "cancelling"};

// ---------------------------------------------------------------- ACP in our words

const statusOf = (status: string | null | undefined): ToolStatus | null =>
	status === "pending" || status === "in_progress" || status === "completed" || status === "failed"
		? status
		: null;

const textOf = (content: {readonly type: string; readonly text?: string}): string | null =>
	content.type === "text" && typeof content.text === "string" ? content.text : null;

/** One ACP `session/update` in our words. */
export function seenOf(update: SessionUpdate): Seen {
	switch (update.sessionUpdate) {
		case "user_message_chunk":
		case "agent_message_chunk": {
			const text = textOf(update.content);
			if (text === null)
				return {kind: "other", what: `${update.sessionUpdate}:${update.content.type}`};
			return {
				kind: "said",
				who: update.sessionUpdate === "user_message_chunk" ? "user" : "agent",
				text,
				id: update.messageId ?? null,
			};
		}
		case "agent_thought_chunk":
			return {kind: "thought"};
		case "tool_call":
			return {
				kind: "tool",
				id: update.toolCallId,
				name: update.name ?? update.kind ?? "other",
				title: update.title,
				status: statusOf(update.status) ?? "pending",
			};
		case "tool_call_update":
			return {
				kind: "tool_update",
				id: update.toolCallId,
				name: update.name ?? null,
				title: update.title ?? null,
				status: statusOf(update.status),
			};
		case "plan":
			return {
				kind: "plan",
				entries: update.entries.map((entry) => ({text: entry.content, status: entry.status})),
			};
		case "current_mode_update":
			return {kind: "mode", id: update.currentModeId};
		case "session_info_update":
			return typeof update.title === "string" && update.title !== ""
				? {kind: "title", title: update.title}
				: {kind: "other", what: "session_info_update"};
		case "usage_update":
			return {
				kind: "context",
				used: update.used,
				size: update.size,
				cost: update.cost?.currency === "USD" ? update.cost.amount : null,
			};
		case "notice":
			return {kind: "notice", severity: update.severity, title: update.title};
		default:
			return {kind: "other", what: update.sessionUpdate};
	}
}

// ---------------------------------------------------------------- the fold

const count = (table: Readonly<Record<string, number>>, key: string) => ({
	...table,
	[key]: (table[key] ?? 0) + 1,
});

/** A turn of this start, or `null` for an event replayed from before it. */
const turnOf = (s: Transcript): number | null => (s.phase === "loading" ? null : s.turn);

function said(s: Transcript, e: Extract<Seen, {kind: "said"}>): Transcript {
	// A harness may echo the prompt back during a live turn: the `turn` Msg already put it in.
	if (e.who === "user" && s.phase !== "loading") return {...s, other: count(s.other, "user_echo")};
	const turn = turnOf(s);
	const last = s.messages.at(-1);
	const same =
		last !== undefined &&
		last.who === e.who &&
		last.turn === turn &&
		(e.id === null || last.id === null || last.id === e.id);
	if (same)
		return {
			...s,
			messages: [
				...s.messages.slice(0, -1),
				{...last, text: last.text + e.text, id: last.id ?? e.id},
			],
		};
	return {...s, messages: [...s.messages, {who: e.who, text: e.text, id: e.id, turn}]};
}

function tooled(s: Transcript, e: Extract<Seen, {kind: "tool" | "tool_update"}>): Transcript {
	const at = s.tools.findIndex((tool) => tool.id === e.id);
	if (at === -1) {
		const tool: Tool = {
			id: e.id,
			name: e.name ?? "other",
			title: e.title ?? "",
			status: e.status ?? "pending",
			turn: turnOf(s),
		};
		return {...s, tools: [...s.tools, tool]};
	}
	const old = s.tools[at] as Tool;
	const tool: Tool = {
		...old,
		name: e.kind === "tool" ? e.name : (e.name ?? old.name),
		title: e.title ?? old.title,
		status: statusAfter(old.status, e.status),
	};
	return {...s, tools: s.tools.map((t, i) => (i === at ? tool : t))};
}

const running = (status: ToolStatus) => status === "pending" || status === "in_progress";

/** A tool call's status after an update. A finished call never runs again: a late update that says so is not taken. */
const statusAfter = (old: ToolStatus, said: ToolStatus | null): ToolStatus =>
	said === null || (!running(old) && running(said)) ? old : said;

function fold(s: Transcript, e: Seen): Transcript {
	switch (e.kind) {
		case "said":
			return said(s, e);
		case "thought":
			return {...s, thoughts: s.thoughts + 1};
		case "tool":
		case "tool_update":
			return tooled(s, e);
		case "plan":
			return {...s, plan: e.entries};
		case "mode":
			return {...s, mode: e.id};
		case "title":
			return {...s, title: e.title};
		case "notice":
			return {
				...s,
				notices: [...s.notices, {severity: e.severity, title: e.title, turn: turnOf(s)}],
			};
		case "context":
			return {...s, context: {used: e.used, size: e.size, cost: e.cost ?? s.context?.cost ?? null}};
		case "other":
			return {...s, other: count(s.other, e.what)};
	}
}

/** A tool still open when its turn ended: the harness never said how it ended. */
const settle = (tools: readonly Tool[], n: number, stop: Stop): readonly Tool[] =>
	tools.map((tool) =>
		tool.turn === n && (tool.status === "pending" || tool.status === "in_progress")
			? {...tool, status: stop === "cancelled" ? "failed" : tool.status}
			: tool,
	);

export const transcript = defineMachine({
	types: {model: {} as Transcript, msg: {} as TranscriptMsg, ctx: undefined},
	cmds: [],
	init: () => [EMPTY, []],
	update: {
		opening: (s, m) => [
			{...s, phase: m.how === "load" ? "loading" : "starting", how: m.how, earlier: m.earlier},
			[],
		],
		opened: (s, m) => [{...s, phase: "idle", mode: m.mode ?? s.mode}, []],
		seen: (s, m) => [m.events.reduce(fold, s), []],
		turn: (s, m) => [
			{
				...s,
				phase: "turn",
				turn: m.n,
				messages: [...s.messages, {who: "user", text: m.prompt, id: null, turn: m.n}],
			},
			[],
		],
		ended: (s, m) => [
			{
				...s,
				phase: "idle",
				turn: null,
				turns: [...s.turns, m.ended],
				tools: settle(s.tools, m.ended.n, m.ended.stop),
				// A turn that ended answers every ask it left open: the harness no longer waits on one.
				asks: [],
				answered:
					s.asks.length === 0
						? s.answered
						: {...s.answered, cancelled: s.answered.cancelled + s.asks.length},
			},
			[],
		],
		asked: (s, m) => [{...s, asks: [...s.asks, m.ask]}, []],
		answered: (s, m) =>
			s.asks.some((ask) => ask.id === m.ask)
				? [
						{
							...s,
							asks: s.asks.filter((ask) => ask.id !== m.ask),
							answered: {...s.answered, [m.answer]: s.answered[m.answer] + 1},
						},
						[],
					]
				: [s, []],
		cancelling: (s) => [s.phase === "turn" ? {...s, phase: "cancelling"} : s, []],
	},
});

/** What the agent said in turn `n` of this start, its messages joined. */
export const saidIn = (s: Transcript, n: number): string =>
	s.messages
		.filter((m) => m.who === "agent" && m.turn === n)
		.map((m) => m.text)
		.join("\n\n");

/**
 * Each turn of this start as its shape, without its words: the prompt, that
 * the agent said something, the end of each tool call, why it stopped, and
 * that it had usage. Two harnesses given the same task should fold to the
 * same shapes, whatever they said.
 */
export const turnShapes = (s: Transcript) =>
	s.turns.map((t) => ({
		turn: t.n,
		prompts: s.messages.filter((m) => m.who === "user" && m.turn === t.n).length,
		said: s.messages.some((m) => m.who === "agent" && m.turn === t.n),
		tools: s.tools.filter((tool) => tool.turn === t.n).map((tool) => tool.status),
		stop: t.stop,
		usage: t.usage !== null,
	}));

/** Counts only, for a trace's tags: never a word the agent or the person wrote. */
export const countsOf = (s: Transcript) => ({
	"acp.phase": s.phase,
	"acp.messages": s.messages.length,
	"acp.thoughts": s.thoughts,
	"acp.tools": s.tools.length,
	"acp.turns": s.turns.length,
	"acp.earlier": s.earlier,
	"acp.asks": s.asks.length,
	"acp.plan": s.plan.length,
	"acp.notices": s.notices.length,
});

/**
 * One short line of where the session stands, for a status line. Room left
 * for `defineProgram`'s own `status` (experiment 73): this is what it would show.
 */
export function statusLine(s: Transcript): string {
	const running = s.tools.filter((t) => t.status === "pending" || t.status === "in_progress");
	const parts = [
		s.phase === "turn" && s.turn !== null ? `turn ${s.turn}` : s.phase,
		`${s.earlier + s.turns.length} turns`,
		...(running.length === 0 ? [] : [`${running.length} tools running`]),
		...(s.asks.length === 0 ? [] : [`${s.asks.length} asks open`]),
		...(s.mode === null ? [] : [`mode ${s.mode}`]),
		...(s.context === null
			? []
			: [`context ${Math.round((100 * s.context.used) / s.context.size)}%`]),
	];
	return parts.join(" · ");
}
