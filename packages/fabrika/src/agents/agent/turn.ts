import {Context, Effect, Schema, type Scope, type Stream} from "effect";
import type {Reads} from "../claude/schema.ts";

// Our own interface to a coding agent, the same for every maker (experiment
// 156). Its shapes are taken from ACP, the Agent Client Protocol, wherever
// they fit: a session, a prompt, streamed updates, tool calls, permission
// asks, a stop reason, cancel by leaving. What ACP lacks for a pipeline is
// added here once, for every adapter (./core.ts): a typed answer, a stop that
// ends child commands, turn token totals, our own session id, and limits.
//
//   const updates = agents.run({provider: "codex", session: "build/42", folder, prompt, answer: Built, ...})
//   // started -> said | tool | asked | tokens ... -> ended {stop, answer, tokens, usd}
//   // Leaving early (the stream is interrupted) is the stop: the agent and its commands end.
//
// The Elm answer: an agent run is a Sub (elm-first.md). This service is the
// effect manager behind it; a Draft's runner maps its updates into the
// Draft's Msgs (./draft.ts), and the machine sees only those.
//
// The top level names no platform: adapters for a maker's SDK, for Codex and
// for ACP live on subpaths.

// ---------------------------------------------------------------- the data, as Effect schemas

/**
 * Why a turn ended. ACP's `StopReason` words, and two of ours: a dollar cap
 * (Claude's own) and the clock this service holds for every adapter.
 */
export const Stop = Schema.Literals([
	"end_turn",
	"max_tokens",
	"max_turn_requests",
	"refusal",
	"cancelled",
	"over_budget",
	"over_time",
]);
export type Stop = typeof Stop.Type;

/** ACP's `ToolCallStatus`. */
export const ToolStatus = Schema.Literals(["pending", "in_progress", "completed", "failed"]);
export type ToolStatus = typeof ToolStatus.Type;

/** A turn's tokens. `cached` is part of `input`. */
export const Tokens = Schema.Struct({
	input: Schema.Number,
	cached: Schema.Number,
	output: Schema.Number,
});
export type Tokens = typeof Tokens.Type;

export const NO_TOKENS: Tokens = {input: 0, cached: 0, output: 0};

/**
 * Where a turn's tokens come from: the maker's own turn total, our sum of each
 * model request's, or only the last request's (all ACP's Codex adapter gives).
 */
export const Counted = Schema.Literals(["turn", "requests", "last", "none"]);
export type Counted = typeof Counted.Type;

/** One thing the agent did or said, as it happened. ACP's `SessionUpdate`, trimmed. */
export const Update = Schema.Union([
	/** The session is open. `session` is ours, never the maker's. */
	Schema.TaggedStruct("started", {session: Schema.String}),
	/** One whole agent message (ACP streams chunks; we join them). */
	Schema.TaggedStruct("said", {text: Schema.String}),
	/** ACP's `tool_call` and `tool_call_update`, joined by `id`. */
	Schema.TaggedStruct("tool", {id: Schema.String, title: Schema.String, status: ToolStatus}),
	/** ACP's `session/request_permission`. Refused: a contained run asks nobody. */
	Schema.TaggedStruct("asked", {id: Schema.String, title: Schema.String}),
	/** The turn's tokens so far. */
	Schema.TaggedStruct("tokens", {tokens: Tokens}),
]);
export type Update = typeof Update.Type;

/**
 * A JSON Schema with nothing in it, as a turn with no `--schema` has: any JSON value fits. No maker
 * is told it, since it would ask for nothing, and Claude's typed-answer tool wants `type: "object"`.
 */
export const asksNothing = (schema: Record<string, unknown>): boolean =>
	Object.keys(schema).length === 0;

/** The turn's end, with the answer read by the stage's schema. `null`: it did not fit. */
export interface Ended<A> {
	readonly _tag: "ended";
	readonly stop: Stop;
	readonly answer: A | null;
	/** What the agent ended with when it did not fit, as it came: only on an `end_turn` with a `null` answer. */
	readonly misfit?: unknown;
	readonly tokens: Tokens;
	readonly counted: Counted;
	/** Dollars, where the maker says; `null` on a plan or where it does not. */
	readonly usd: number | null;
	/** The maker's own count of model requests, where it says. */
	readonly requests: number | null;
}

export type Heard<A> = Update | Ended<A>;

export const AgentFailedWhy = Schema.Literals([
	/** No adapter by that name in the table. */
	"no_provider",
	/** The turn asks for a limit the adapter cannot hold. */
	"cannot_limit",
	/** The session is someone else's: opened on another provider. */
	"other_provider",
	/** The turn's system prompt does not read: a `replace` prompt with no text that got past its type. */
	"system",
	/** Containment refused to start: the plan check, the home, a tool list. */
	"contain",
	/** The agent did not start. */
	"start",
	/** The agent broke mid-turn. */
	"broke",
]);
export type AgentFailedWhy = typeof AgentFailedWhy.Type;

export class AgentFailed extends Schema.TaggedError<AgentFailed>()("AgentFailed", {
	why: AgentFailedWhy,
	message: Schema.String,
}) {}

export const failed = (why: AgentFailedWhy, message: string) => new AgentFailed({why, message});

// ---------------------------------------------------------------- what a stage asks

/** Limits on one turn. `null`: no limit of that kind. */
export interface Limits {
	/** Dollars. Only an adapter that holds it may be given one: else the turn fails at start. */
	readonly usd: number | null;
	/** Tool calls. Counted here, for every adapter. */
	readonly tools: number | null;
	/** Wall-clock seconds. Held here, for every adapter. */
	readonly seconds: number | null;
}

export const NO_LIMITS: Limits = {usd: null, tools: null, seconds: null};

/**
 * A `replace` prompt's text: something more than spaces and line ends.
 * Branded, so a plain string does not type as one; it is made only through
 * the schema: `NonBlank.make(...)`, which throws on blank text, or a decode.
 *
 *   {_tag: "replace", text: NonBlank.make("You sort one ticket.")}   // types
 *   {_tag: "replace", text: ""}                                      // does not type
 */
export const NonBlank = Schema.String.check(
	Schema.isPattern(/\S/, {message: "a replace system prompt with no text"}),
).pipe(Schema.brand("NonBlank"));
export type NonBlank = typeof NonBlank.Type;

// The two cases, as each maker's own setting (`claudeSystem` and `codexSystem`
// in ../acp/harness.ts; ACP's rows send the same). The fake records it.
//
// append   Claude SDK: {type: "preset", preset: "claude_code", append: text, snapshot: false}   Codex: developer_instructions = text
// replace  Claude SDK: {type: "custom", prompt: text, snapshot: false}                         Codex: model_instructions_file, a file holding text

/**
 * A turn's system prompt. Two cases and no third, so "no prompt at all"
 * cannot be picked by mistake (a-ticket-runs-from-the-app.md, section 5):
 *
 *   - `append`: the maker's own coding prompt, then `text`. For a stage that codes.
 *   - `replace`: `text` alone, in place of the maker's. For a stage with no tools.
 *
 * The names are the words each maker's docs use for the two behaviours.
 */
export const SystemPrompt = Schema.Union([
	Schema.TaggedStruct("append", {text: Schema.String}),
	Schema.TaggedStruct("replace", {text: NonBlank}),
]);
export type SystemPrompt = typeof SystemPrompt.Type;

/** One turn, as a stage asks for it. Plain data but the schema. */
export interface Turn<A> {
	/** A row of the provider table: config, not code. */
	readonly provider: string;
	/** Ours. The first turn under it opens a session; a later one carries it on. */
	readonly session: string;
	/** The folder the agent works in, as an absolute path. */
	readonly folder: string;
	readonly prompt: string;
	/** The system prompt. Never left out: a turn with none does not type. */
	readonly system: SystemPrompt;
	/** The answer's schema. The last message is read by it. */
	readonly answer: Reads<A>;
	readonly model: string | null;
	readonly effort: string | null;
	readonly limits: Limits;
}

// ---------------------------------------------------------------- what an adapter does

/** What an adapter says while it runs, before this service adds its part. */
export type Raw =
	| {readonly _tag: "opened"; readonly own: string}
	| {readonly _tag: "said"; readonly text: string}
	| {
			readonly _tag: "tool";
			readonly id: string;
			readonly title: string;
			readonly status: ToolStatus;
	  }
	| {readonly _tag: "asked"; readonly id: string; readonly title: string}
	/** One model request's tokens (`whole: false`), or the turn's total (`whole: true`). */
	| {readonly _tag: "tokens"; readonly tokens: Tokens; readonly whole: boolean}
	| {
			readonly _tag: "ended";
			readonly stop: Stop;
			/** The maker's own typed answer, where it has one (Claude's `structured_output`). */
			readonly structured: unknown;
			readonly usd: number | null;
			readonly requests: number | null;
			/** Only the last request's tokens are known (ACP's `PromptResponse.usage`). */
			readonly last?: Tokens;
	  };

/** What an adapter is handed: the turn, with our session mapped to the maker's. */
export interface AdapterTurn {
	readonly folder: string;
	readonly prompt: string;
	/** The turn's system prompt, as the stage gave it: the adapter maps it to its maker's way. */
	readonly system: SystemPrompt;
	/** The answer as JSON Schema, for an adapter that takes one natively. */
	readonly schema: Record<string, unknown>;
	/** The maker's session to carry on, or `null` to open a new one. */
	readonly resume: string | null;
	/** Ours, for an adapter whose maker lets the client pick the id (Claude's `sessionId`). */
	readonly session: string;
	readonly model: string | null;
	readonly effort: string | null;
	readonly usd: number | null;
}

/** A turn that has started. Its scope holds the process; closing it kills it, hard. */
export interface Running {
	readonly updates: Stream.Stream<Raw, AgentFailed>;
	/** The agent's process, whose children are reaped at the stop. `null`: none (the fake, in process). */
	readonly pid: number | null;
	/** The maker's own gentle stop: interrupt, SIGINT, `session/cancel`. Waits for it, never fails. */
	readonly stop: Effect.Effect<void>;
}

export interface Adapter {
	readonly name: string;
	/** What the maker holds on its own. The rest this service adds. */
	readonly holds: {
		/** A dollar cap. */
		readonly usd: boolean;
		/** A typed answer by schema. Else the prompt carries the schema and the last message is read. */
		readonly schema: boolean;
	};
	readonly start: (turn: AdapterTurn) => Effect.Effect<Running, AgentFailed, Scope.Scope>;
}

// ---------------------------------------------------------------- the two things the service stands on

/** Our session ids, mapped to each maker's. Kept beside the work, so a new process carries on. */
export interface Sessions {
	readonly get: (session: string) => Effect.Effect<{provider: string; own: string} | null>;
	readonly put: (session: string, provider: string, own: string) => Effect.Effect<void>;
}

/** The processes under an agent: found before the stop, killed when they outlive it. */
export interface Reaper {
	readonly tree: (pid: number) => Effect.Effect<readonly number[]>;
	readonly alive: (pids: readonly number[]) => Effect.Effect<readonly number[]>;
	readonly kill: (pids: readonly number[]) => Effect.Effect<void>;
}

/** Nothing to reap: for adapters with no process, as in a test. */
export const noReaper: Reaper = {
	tree: () => Effect.succeed([]),
	alive: () => Effect.succeed([]),
	kill: () => Effect.void,
};

// ---------------------------------------------------------------- the service

/** What a stop did, for a log or a trace; the machine never reads it. */
export interface Stopped {
	readonly provider: string;
	readonly session: string;
	/** From the stop's start to the agent's process tree being gone, or given up on. */
	readonly ms: number;
	/** Processes under the agent when the stop began. */
	readonly under: number;
	/** Of those, the ones that outlived the maker's own stop and were killed. */
	readonly killed: number;
}

export class Agents extends Context.Service<
	Agents,
	{
		/** One turn. Leaving the stream early is the stop. */
		readonly run: <A>(turn: Turn<A>) => Stream.Stream<Heard<A>, AgentFailed>;
		/** Whether a session of ours is known, and on which provider: so a stage picks "carry on" or "start". */
		readonly knows: (session: string) => Effect.Effect<string | null>;
	}
>()("@kampus/fabrika-old/Agents") {}
