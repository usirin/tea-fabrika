import {type Options, type Query, query, type SDKMessage} from "@anthropic-ai/claude-agent-sdk";
import type {DepKeyedSub, Sub} from "@demlik/tea";
import {Effect, Option, Queue, Stream} from "effect";
import {jsonSchema, type Reads, reader} from "./schema.ts";

// Draft: an agent produces something. Run as a Sub over the Agent SDK's
// message stream, as experiment 43 found it has to be: a Cmd holds the fold
// until it settles, so nothing could be judged, timed or stopped while the
// agent works. The parent says what it wants as data (the prompt, the agent,
// the conversation, picked before the run starts) for as long as it wants it;
// leaving the phase turns the Sub off, and the engine closes the runner, which
// interrupts the agent. The answer is typed by a schema, and an answer that
// does not fit it comes back as `null`, never as text the machine reads.

/** One agent run, as the parent asks for it. Plain data: it is the Sub's deps. */
export interface DraftRun {
	/** The child of the parent this run belongs to. Every Msg carries it back. */
	readonly key: string;
	/** This run, so a late Msg from an earlier one is told apart. */
	readonly id: string;
	readonly prompt: string;
	/** The conversation, named before the run starts. `continues`: one the agent already had. */
	readonly session: {readonly id: string; readonly continues: boolean};
	/** A named agent to run as (its prompt, tools and model), or `null` for a plain session. */
	readonly agent: string | null;
	/** The folder it works in, by the name the host gave it; the runner turns it into a path. `null`: the host's own. */
	readonly folder: string | null;
}

/** What a run cost, from the SDK's result. */
export interface Spend {
	readonly costUsd: number;
	/** Every token billed, each turn's whole input counted again: what the dollars follow. */
	readonly tokens: number;
	/**
	 * How large the conversation was at its last turn. This is the number a
	 * Claude Code subagent reports as its tokens, so it is the one to set beside
	 * a run an agent drove. 0 when nobody saw a turn.
	 */
	readonly context: number;
	readonly turns: number;
	readonly minutes: number;
}

export const noSpend: Spend = {costUsd: 0, tokens: 0, context: 0, turns: 0, minutes: 0};

/** The agent asked for a tool. Progress only: a parent may count it, or judge it as watch.ts does. */
export interface DraftTool<N extends string> {
	readonly type: `${N}_tool`;
	readonly key: string;
	readonly id: string;
	readonly tool: string;
}

/** The agent ended on its own. `output` is `null` when its answer did not fit the schema. */
export interface DraftFinished<N extends string, O> {
	readonly type: `${N}_finished`;
	readonly key: string;
	readonly id: string;
	readonly output: O | null;
	readonly session: string;
	readonly spend: Spend;
}

/** The run broke: the stream failed, or it ended with an error result. */
export interface DraftFailed<N extends string> {
	readonly type: `${N}_failed`;
	readonly key: string;
	readonly id: string;
	readonly error: string;
	readonly spend: Spend;
}

export type DraftMsg<N extends string, O> = DraftTool<N> | DraftFinished<N, O> | DraftFailed<N>;

/**
 * Make one kind of Draft: its Sub, its Msgs, and how SDK messages become them.
 * `output` is an Effect schema (or, until the repo is off zod, a zod one).
 * Either way the agent is handed it as JSON Schema and its answer is read
 * against it; src/schema.ts does both.
 */
export function createDraft<const N extends string, O>(config: {
	readonly name: N;
	readonly output: Reads<O>;
}) {
	const {name, output} = config;
	const read = reader(output);
	/** `read` on a text taken as JSON. Nothing at all, where parsing it throws. */
	const readJson = Option.liftThrowable((text: string) => read(JSON.parse(text)));
	const types = {
		tool: `${name}_tool`,
		finished: `${name}_finished`,
		failed: `${name}_failed`,
	} as const;
	type Msg = DraftMsg<N, O>;

	/** The Sub entry: on while `deps` names a run. */
	const sub = <S>(deps: (state: S) => DraftRun | null): DepKeyedSub<S, Sub<N, DraftRun>> =>
		({type: name, deps}) as DepKeyedSub<S, Sub<N, DraftRun>>;

	type Usage = {
		readonly input_tokens: number;
		readonly output_tokens: number;
		readonly cache_creation_input_tokens?: number | null;
		readonly cache_read_input_tokens?: number | null;
	};
	const total = (u: Usage) =>
		u.input_tokens +
		u.output_tokens +
		(u.cache_creation_input_tokens ?? 0) +
		(u.cache_read_input_tokens ?? 0);

	const spendOf = (m: Extract<SDKMessage, {type: "result"}>, context: number): Spend => ({
		costUsd: m.total_cost_usd,
		tokens: total(m.usage),
		context,
		turns: m.num_turns,
		minutes: m.duration_ms / 60_000,
	});

	/** The size of the top conversation as one of its turns reports it, or `null` for any other message. */
	const contextOf = (message: SDKMessage): number | null =>
		message.type === "assistant" && message.parent_tool_use_id === null
			? total(message.message.usage as Usage)
			: null;

	/**
	 * The Msgs one SDK message carries. Only the top conversation's tool calls
	 * count as progress. `context` is the conversation's size at its last turn,
	 * which the result does not say; the runner keeps it from the turns it saw.
	 */
	function msgsOf(message: SDKMessage, run: DraftRun, context = 0): Msg[] {
		const {key, id} = run;
		if (message.type === "assistant" && message.parent_tool_use_id === null) {
			return message.message.content.flatMap((block) =>
				block.type === "tool_use" ? [{type: types.tool, key, id, tool: block.name} as Msg] : [],
			);
		}
		if (message.type !== "result") return [];
		const spend = spendOf(message, context);
		if (message.subtype !== "success" || message.is_error) {
			return [
				{
					type: types.failed,
					key,
					id,
					error: `${message.subtype}${message.is_error ? " (error)" : ""}`,
					spend,
				} as Msg,
			];
		}
		return [
			{
				type: types.finished,
				key,
				id,
				output: answerOf(message.structured_output, message.result),
				session: message.session_id,
				spend,
			} as Msg,
		];
	}

	/**
	 * The typed answer: the SDK's structured output when there is one, else the
	 * last JSON object in the agent's closing text that fits the schema. A named
	 * agent with its own tool list is not given the SDK's answer tool, and
	 * writes the object out in its last message instead (the runner dry run).
	 */
	function answerOf(structured: unknown, text: string): O | null {
		const direct = read(structured);
		if (Option.isSome(direct)) return direct.value;
		const objects =
			typeof text === "string" ? [...text.matchAll(/\{[^{}]*\}/g)].map((m) => m[0]) : [];
		for (const candidate of objects.reverse()) {
			// Not JSON, or not the answer's shape: try the one before it.
			const parsed = Option.flatten(readJson(candidate));
			if (Option.isSome(parsed)) return parsed.value;
		}
		return null;
	}

	/** The answer's shape as JSON Schema, for the SDK's `outputFormat`. */
	const schema = jsonSchema(output);

	/** Which of the three a Msg is. A template-literal type does not narrow on a generic name, so these do. */
	const is = {
		tool: (m: Msg): m is DraftTool<N> => m.type === types.tool,
		finished: (m: Msg): m is DraftFinished<N, O> => m.type === types.finished,
		failed: (m: Msg): m is DraftFailed<N> => m.type === types.failed,
	};

	return {name, types, is, sub, msgsOf, contextOf, schema, output};
}

export type Draft<N extends string, O> = ReturnType<typeof createDraft<N, O>>;

/** The SDK's own tool for a typed answer. It is in a run's list because the runner asks for one. */
const ANSWER_TOOL = "StructuredOutput";

/**
 * How many tools the SDK lists that the run's options did not name. `tools`
 * in the options is the whole list a run may have, so anything else in the
 * SDK's list came from somewhere the run did not choose: a server of tools,
 * a connector of the signed-in account. A count and not the names: a name
 * would say which services that account has connected.
 *
 * Options that name no list (the SDK's default tools) give nothing to hold
 * the SDK's list against, so this answers 0 for them.
 */
export function extraTools(named: Options["tools"], listed: readonly string[]): number {
	if (!Array.isArray(named)) return 0;
	const own = new Set([...named, ANSWER_TOOL]);
	return listed.filter((tool) => !own.has(tool)).length;
}

/** What the runner uses of an SDK query: its messages, and the two ways to stop it. */
export type Opened = AsyncIterable<SDKMessage> & Pick<Query, "interrupt" | "close">;

/** Opens the query of one run: the SDK's `query`, or a scripted one in a test. */
export type Open = (params: {readonly prompt: string; readonly options: Options}) => Opened;

/**
 * The live runner, on the Effect engine: open a query for the run, feed every
 * SDK message to the machine as Msgs, and interrupt the query when the Sub
 * closes (the machine left the phase). `options` adds what the use needs: the
 * folder, plugins, tools, budget. A new conversation is opened under the id
 * the parent picked; a continued one is resumed. `more.prompt` turns the
 * run's prompt into what the agent is sent (a host may put a skill before
 * it); `more.seen` is shown every SDK message, for a log the machine never reads.
 *
 * The SDK says which tools the agent has in its `init` message, which comes
 * before anything the model says. A list that holds a tool the options did
 * not name ({@link extraTools}) ends the run there as failed: the query is
 * closed, which stops the agent's process, and no later message is read.
 * `more.open` is how the query is opened, for a test.
 */
export const sdkRunner =
	<N extends string, O>(
		draft: Draft<N, O>,
		options: (run: DraftRun) => Options,
		more: {
			readonly prompt?: (run: DraftRun) => string;
			readonly seen?: (run: DraftRun, message: SDKMessage) => void;
			readonly open?: Open;
		} = {},
	) =>
	(sub: Sub<N, DraftRun>) =>
		Stream.callback<DraftMsg<N, O>>((queue) =>
			Effect.acquireRelease(
				Effect.sync(() => {
					const run = sub.deps;
					const named = options(run);
					const q = (more.open ?? query)({
						prompt: more.prompt === undefined ? run.prompt : more.prompt(run),
						options: {
							...named,
							...(run.agent === null ? {} : {agent: run.agent}),
							...(run.session.continues ? {resume: run.session.id} : {sessionId: run.session.id}),
							outputFormat: {type: "json_schema", schema: draft.schema},
						},
					});
					const live = {on: true, result: false, context: 0};
					const fail = (error: string) => {
						if (live.on)
							Queue.offerUnsafe(queue, {
								type: draft.types.failed,
								key: run.key,
								id: run.id,
								error,
								spend: noSpend,
							} as DraftMsg<N, O>);
					};
					const loop = (async () => {
						// biome-ignore lint/plugin: a plain loop over the SDK's stream, outside Effect on purpose: it keeps reading after the Sub closes, and its catch turns the SDK's throw into a Msg
						try {
							for await (const m of q) {
								more.seen?.(run, m);
								const extra =
									m.type === "system" && m.subtype === "init"
										? extraTools(named.tools, m.tools)
										: 0;
								if (extra > 0) {
									// The run is over, as after a result: nothing is left to interrupt, and what the SDK throws on the way out is no news.
									live.result = true;
									q.close();
									fail(
										`the SDK listed ${extra} tool${extra === 1 ? "" : "s"} the run's options do not name, so the run was ended at its start`,
									);
									return;
								}
								live.context = draft.contextOf(m) ?? live.context;
								if (m.type === "result") live.result = true;
								if (live.on)
									for (const msg of draft.msgsOf(m, run, live.context))
										Queue.offerUnsafe(queue, msg);
							}
							if (!live.result) fail("the stream ended with no result");
						} catch (error) {
							// The SDK throws after an error result it already sent; only a throw before one is news.
							if (!live.result) fail(String(error));
						}
					})();
					return {q, live, loop};
				}),
				({q, live, loop}) =>
					// biome-ignore lint/plugin: closing a scope has no way to fail with a typed error; the interrupt's failure is caught, both waits time out, and a throw from `close` is a bug
					Effect.promise(async () => {
						live.on = false;
						if (!live.result) {
							await Promise.race([
								q.interrupt().catch(() => undefined),
								new Promise((r) => setTimeout(r, 10_000)),
							]);
							await Promise.race([loop, new Promise((r) => setTimeout(r, 30_000))]);
						}
						q.close();
					}),
			),
		);
