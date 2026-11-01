import type * as acp from "@agentclientprotocol/sdk/unstable";
import {type Cause, Effect, Exit, type FileSystem, Queue, Scope, Stream} from "effect";
import type {ChildProcessSpawner} from "effect/process";
import {
	type Adapter,
	type AdapterTurn,
	type AgentFailed,
	failed,
	type Raw,
	type Stop,
} from "../agent/turn.ts";
import type {Env} from "../claude/env.ts";
import {TOOLS} from "../claude/sandbox.ts";
import {connect, type Heard} from "./client.ts";
import {claudeOptions, claudeSystem, harnessOf, type Row, rowName, withSystem} from "./harness.ts";

// Any harness that speaks ACP, as an adapter of the interface
// (../agent/turn.ts): our ACP client (./client.ts) on a row of the harness
// table (./harness.ts), with that row's containment. For an agent that speaks
// only ACP; Claude and Codex can run through it too, which is how experiment
// 156 compares the two paths.
//
// What ACP gives, and so what this adapter can say: message chunks (joined
// here into whole messages), tool calls by id with their status, permission
// asks (each refused: a contained run asks nobody), the stop reason, and the
// last request's tokens (`PromptResponse.usage`). What it lacks the interface
// adds. Claude's adapter also forwards the SDK's raw result
// (`_claude/sdkMessage`): the turn's tokens and dollars, read here when there.

const STOPS: Readonly<Record<acp.StopReason, Stop>> = {
	end_turn: "end_turn",
	max_tokens: "max_tokens",
	max_turn_requests: "max_turn_requests",
	refusal: "refusal",
	cancelled: "cancelled",
};

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
const num = (v: unknown, key: string) => (isRecord(v) && typeof v[key] === "number" ? v[key] : 0);

/** The SDK result Claude's adapter forwards, as raw tokens and its numbers; `null` for anything else. */
export const claudeResultOf = (params: unknown) => {
	const m = isRecord(params) ? params.message : null;
	if (!isRecord(m) || m.type !== "result") return null;
	const u = m.usage;
	return {
		tokens: {
			input:
				num(u, "input_tokens") +
				num(u, "cache_read_input_tokens") +
				num(u, "cache_creation_input_tokens"),
			cached: num(u, "cache_read_input_tokens"),
			output: num(u, "output_tokens"),
		},
		usd: num(m, "total_cost_usd"),
		requests: num(m, "num_turns"),
		over: m.subtype === "error_max_budget_usd",
	};
};

/** One ACP update, as raw updates; `said` is handed whole by the caller. Pure. */
export const rawOfUpdate = (u: acp.SessionUpdate): Raw[] => {
	switch (u.sessionUpdate) {
		case "tool_call":
			return [{_tag: "tool", id: u.toolCallId, title: u.title, status: u.status ?? "pending"}];
		case "tool_call_update":
			return u.status === undefined || u.status === null
				? []
				: [{_tag: "tool", id: u.toolCallId, title: u.title ?? "", status: u.status}];
		default:
			return [];
	}
};

/**
 * The `_meta` Claude's row opens each session with: the builder's options,
 * the turn's system prompt among them, and the SDK result forwarded for the
 * turn's tokens and dollars. Pure.
 */
export const claudeMetaOf = (turn: Pick<AdapterTurn, "folder" | "usd" | "system">) => ({
	claudeCode: {
		options: {
			...claudeOptions(turn.folder, turn.usd),
			allowedTools: [...TOOLS],
			// Spread by Claude's adapter over its own default, the bare preset.
			systemPrompt: claudeSystem(turn.system),
		},
		emitRawSDKMessages: [{type: "result"}],
	},
});

/** `row`: `"claude"`, `"fake"`, or `{name: "codex", access}`, where every turn may change its folder or only read it. */
export const acpAdapter = (
	row: Row,
	parent: Env = process.env,
): Effect.Effect<Adapter, never, ChildProcessSpawner.ChildProcessSpawner | FileSystem.FileSystem> =>
	Effect.gen(function* () {
		const name = rowName(row);
		const context = yield* Effect.context<
			ChildProcessSpawner.ChildProcessSpawner | FileSystem.FileSystem
		>();
		return {
			name: `acp-${name}`,
			// Claude's row holds a dollar cap (`maxBudgetUsd` in its options); ACP has no schema field.
			holds: {usd: name === "claude", schema: false},
			start: (turn) =>
				Effect.gen(function* () {
					// ACP has no system prompt field: each row is told the turn's in its own way (`withSystem`).
					const harness = withSystem(
						harnessOf(row, turn.folder, turn.usd, parent),
						turn.system,
						turn.folder,
						parent,
					);
					if (harness.prepare !== undefined)
						yield* harness.prepare.pipe(Effect.mapError((why) => failed("contain", why)));
					// The connection's own scope: the gentle stop closes it, and with it the process.
					const scope = yield* Scope.make();
					yield* Effect.addFinalizer(() => Scope.close(scope, Exit.void));
					const queue = yield* Queue.unbounded<Raw, AgentFailed | Cause.Done>();
					const said = {text: ""};
					const flush = () => {
						if (said.text !== "") Queue.offerUnsafe(queue, {_tag: "said", text: said.text});
						said.text = "";
					};
					const claude = {result: null as ReturnType<typeof claudeResultOf>};
					const heard = (h: Heard) => {
						if (h.kind === "ask") {
							flush();
							// Refused: a contained run asks nobody. ACP's own words for "no".
							const no = h.ask.request.options.find((o) => o.kind === "reject_once");
							h.ask.answer(
								no === undefined
									? {outcome: {outcome: "cancelled"}}
									: {outcome: {outcome: "selected", optionId: no.optionId}},
							);
							Queue.offerUnsafe(queue, {
								_tag: "asked",
								id: h.ask.request.toolCall.toolCallId,
								title: h.ask.request.toolCall.title ?? "",
							});
							return;
						}
						const u = h.update;
						if (u.sessionUpdate === "agent_message_chunk") {
							if (u.content.type === "text") said.text += u.content.text;
							return;
						}
						const raws = rawOfUpdate(u);
						if (raws.length > 0) flush();
						for (const r of raws) Queue.offerUnsafe(queue, r);
					};
					const c = yield* connect(harness, turn.folder, heard, {
						methods: name === "claude" ? ["_claude/sdkMessage"] : [],
						heard: (_method, params) => {
							claude.result = claudeResultOf(params) ?? claude.result;
						},
					}).pipe(
						Scope.provide(scope),
						Effect.mapError((e) => failed("start", `${e.method}: ${e.message}`)),
					);
					const meta = name === "claude" ? claudeMetaOf(turn) : harness.meta;
					const how = turn.resume === null ? "new" : c.can("resume") ? "resume" : "load";
					let opened = yield* c
						.open(how, turn.resume, turn.folder, meta)
						.pipe(Effect.mapError((e) => failed("start", `${e.method}: ${e.message}`)));
					/** `optional`: a model with no such option (a small model has no effort) keeps going without it. */
					const set = (category: string, value: string | null, optional = false) =>
						value === null || (optional && !opened.config.some((o) => o.category === category))
							? Effect.succeed(opened)
							: c
									.configure(opened, category, value)
									.pipe(Effect.mapError((e) => failed("start", e.message)));
					opened = yield* set("model", turn.model);
					opened = yield* set("thought_level", turn.effort, true);
					// Claude: never the owner's own default. ACP offers no `dontAsk`; `acceptEdits` runs edits,
					// the sandbox lets the shell run, and any other ask comes here and is refused.
					if (name === "claude") opened = yield* set("mode", "acceptEdits");
					// A load replays the old turns: what came before this prompt is not this turn's.
					said.text = "";
					Queue.offerUnsafe(queue, {_tag: "opened", own: opened.id});
					yield* c.prompt(opened.id, turn.prompt).pipe(
						Effect.map((r): Raw[] => {
							flush();
							const r2 = claude.result;
							const last =
								r.usage === undefined || r.usage === null
									? undefined
									: {
											input: r.usage.inputTokens + (r.usage.cachedReadTokens ?? 0),
											cached: r.usage.cachedReadTokens ?? 0,
											output: r.usage.outputTokens,
										};
							return [
								...(r2 === null ? [] : [{_tag: "tokens", tokens: r2.tokens, whole: true} as const]),
								{
									_tag: "ended",
									stop: r2?.over === true ? "over_budget" : STOPS[r.stopReason],
									structured: undefined,
									usd: r2?.usd ?? null,
									requests: r2?.requests ?? null,
									...(last === undefined ? {} : {last}),
								},
							];
						}),
						Effect.matchEffect({
							onSuccess: (raws) =>
								Effect.sync(() => {
									for (const r of raws) Queue.offerUnsafe(queue, r);
									Queue.endUnsafe(queue);
								}),
							// Claude's adapter answers a spent cap with an RPC error, not a stop reason; the SDK
							// result it forwarded first says which, so the turn ends `over_budget`, not broken.
							onFailure: (e) =>
								claude.result?.over === true
									? Effect.sync(() => {
											flush();
											const r2 = claude.result;
											if (r2 !== null)
												Queue.offerUnsafe(queue, {_tag: "tokens", tokens: r2.tokens, whole: true});
											Queue.offerUnsafe(queue, {
												_tag: "ended",
												stop: "over_budget",
												structured: undefined,
												usd: r2?.usd ?? null,
												requests: r2?.requests ?? null,
											});
											Queue.endUnsafe(queue);
										})
									: Queue.fail(queue, failed("broke", `${e.method}: ${e.message}`)),
						}),
						Effect.forkIn(scope),
					);
					return {
						updates: Stream.fromQueue(queue),
						pid: c.pid,
						// Cancel the turn, then close the process: a cancel alone leaves its command running (153).
						stop: c
							.cancel(opened.id)
							.pipe(
								Effect.ignore,
								Effect.andThen(Effect.sleep("300 millis")),
								Effect.andThen(Scope.close(scope, Exit.void)),
							),
					};
				}).pipe(Effect.provide(context)),
		};
	});
