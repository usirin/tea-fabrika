import {
	Cause,
	Clock,
	Effect,
	Exit,
	Fiber,
	JsonSchema,
	Queue,
	Schema,
	SchemaRepresentation,
	Stream,
} from "effect";
import {defineProgram, type Given, type Kept, kind, start, tell} from "../../program/program.ts";
import {flag, input, output} from "../../program/shape.ts";
import {
	AgentFailed,
	Agents,
	Counted,
	type Ended,
	type Heard,
	type Limits,
	Tokens,
	ToolStatus,
	type Turn,
} from "../agent/turn.ts";
import type {DraftMsg, DraftRun, Spend} from "../claude/draft.ts";
import type {Reads} from "../claude/schema.ts";
import {
	Conversation,
	conversation,
	End,
	EndStop,
	type Provider,
	type TurnSeen,
} from "./conversation.ts";

// `claude` and `codex` as tea programs (experiment 169), made by one function
// so neither is shaped around the other. Each is a thin program on the
// `Agents` service (docs/direction/agents-behind-one-service.md): it names a
// provider row, and imports no maker's SDK.
//
//   claude --folder /tmp/s prompt="what is 2+3?"      a turn; `said`, `tool`, then `ended`
//   tell %1 prompt "and times 4?"                     the next turn, on the same session
//   tell %1 cancel 2                                  turn 2, cancelled: now, or when it comes up
//   tell %1 cancel now                                whatever turn runs now
//
// One definition, two entries, the way BusyBox is one binary that acts by the
// name it is started under (https://busybox.net/about.html). The provider is the
// program's name, not a flag: a person types `claude` or `codex`, as in a
// terminal.
//
// The program never knows whether a person watches. It runs each prompt as a
// turn until its `prompt` input closes, then ends. A tile keeps that input
// open, which is a chat; a parent tells one prompt and closes it, which is
// `claude -p` or `codex exec`. Its window is its view, the kept
// conversation; whether a host draws it is the host's call (the write-up's
// isatty section).
//
// The typed answer, three ways (the write-up measures them):
//   A  `agentProgram(provider)`, no `answer` flag: the agent's last JSON value, checked by the stage.
//   B  `agentProgram(provider)` with `--answer <JSON Schema>`: the provider is held to it, and the
//      program reads by it. A check JSON Schema cannot say is lost on the way.
//   C  `typedAgentProgram(provider, Schema)`: the stage's own schema, at definition. `ended`'s shape
//      is `A | null`, so a value that does not fit cannot be sent, and a pipe checks it by `fit`.

/** Why the program would not go on. */
export interface AgentRefused {
	readonly _tag: "agent_refused";
	readonly message: string;
}
const refused = (message: string) => Effect.fail<AgentRefused>({_tag: "agent_refused", message});

const Count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
const Positive = Schema.Finite.check(Schema.isGreaterThan(0));

/** A cancel names a turn, or says `now`: whatever runs when it is read. */
export const Cancel = Schema.Union([Count, Schema.Literal("now")]);
export type Cancel = typeof Cancel.Type;

const FLAGS = {
	folder: flag(Schema.String, "The folder the agent works in: an absolute path."),
	session: flag(
		Schema.UndefinedOr(Schema.String),
		"Our session id. Left out: a new one, kept with the run. The same id carries on a session.",
	),
	model: flag(Schema.UndefinedOr(Schema.String), "The model, by the provider's own name."),
	effort: flag(
		Schema.UndefinedOr(Schema.String),
		"How hard it thinks, by the provider's own value.",
	),
	system: flag(
		Schema.UndefinedOr(Schema.String),
		"Text added after the provider's own coding prompt.",
	),
	usd: flag(
		Schema.UndefinedOr(Positive),
		"Dollars one turn may cost. Only a provider that holds a cap takes it; the other fails the turn at start.",
	),
	tools: flag(
		Schema.UndefinedOr(Schema.Int.check(Schema.isGreaterThan(0))),
		"Tool calls one turn may make.",
	),
	seconds: flag(Schema.UndefinedOr(Positive), "Seconds one turn may take."),
};

const INPUTS = {
	prompt: input(Schema.String, "A prompt: one turn, after the turns before it."),
	allow: input(Schema.String, "The id of an ask waiting: allow it, once."),
	refuse: input(Schema.String, "The id of an ask waiting: refuse it."),
	cancel: input(Cancel, "A turn's number, or now: that turn is cancelled."),
};

const Started = Schema.Struct({
	provider: Schema.Literals(["claude", "codex"]),
	session: Schema.String,
	/** The service knew the session already: the provider carries it on. */
	resumed: Schema.Boolean,
	/** Turns a kill cut off, sent again now. */
	resent: Count,
});
const Said = Schema.Struct({turn: Count, text: Schema.String});
const Tool = Schema.Struct({
	turn: Count,
	id: Schema.String,
	title: Schema.String,
	status: ToolStatus,
});
const AskOut = Schema.Struct({
	/** `null`: an allow or refuse for an ask no turn made. */
	turn: Schema.NullOr(Count),
	id: Schema.String,
	title: Schema.String,
	/** `refused`: the contained run refused it at once. `not_waiting`: nothing waits on that id. */
	answer: Schema.Literals(["refused", "not_waiting"]),
});

/** The `ended` output, its answer typed by `answer`. */
const endedOutput = <A>(answer: Schema.Codec<A, A>) =>
	Schema.Struct({
		turn: Count,
		stop: EndStop,
		answer: Schema.NullOr(answer),
		tokens: Tokens,
		counted: Counted,
		usd: Schema.NullOr(Schema.Finite),
		requests: Schema.NullOr(Count),
		ms: Count,
		error: Schema.NullOr(Schema.String),
	});

/** The answer's JSON Schema as a flag value: way B. */
const AnswerSchema = Schema.UndefinedOr(Schema.Record(Schema.String, Schema.Json));

/** A JSON Schema handed in as data, as a schema the service reads by. Effect's own importer. */
const readsFrom = (json: Readonly<Record<string, Schema.Json>>) =>
	Effect.try({
		try: () =>
			SchemaRepresentation.fromJsonSchemaDocument(
				JsonSchema.fromSchemaDraft2020_12(json as JsonSchema.JsonSchema),
			),
		catch: (e) =>
			({
				_tag: "agent_refused",
				message: `--answer is no JSON Schema: ${String(e)}`,
			}) as AgentRefused,
	});

const NO_END = {
	tokens: {input: 0, cached: 0, output: 0},
	counted: "none",
	usd: null,
	requests: null,
} as const;

/** The program, for one provider, its answer read by what `reads` gives. */
function build<A, X extends typeof FLAGS>(config: {
	readonly provider: Provider;
	readonly name: string;
	readonly description: string;
	readonly flags: X;
	readonly answer: Schema.Codec<A, A>;
	readonly reads: (flags: Given<X>) => Effect.Effect<Reads<A>, AgentRefused>;
}) {
	const {provider} = config;
	return defineProgram({
		name: config.name,
		description: config.description,
		flags: config.flags,
		inputs: INPUTS,
		outputs: {
			started: output(
				Started,
				"Once per start: our session, and whether the provider carries it on.",
			),
			said: output(Said, "One whole message the agent said in a turn."),
			tool: output(Tool, "A tool call, as it starts and as it ends."),
			ask: output(AskOut, "A permission ask, and how it was answered."),
			ended: output(
				endedOutput(config.answer),
				"Each turn's end: why it stopped, its typed answer or null, its tokens and dollars.",
			),
		},
		machines: {
			conversation: kind({
				machine: conversation,
				state: Conversation,
				parent: "main",
				options: () => ({ctx: undefined}),
				drawing: () => ({name: `${provider} conversation`, steps: {}}),
				status: Conversation.status,
			}),
		},
		view: {machine: "conversation", data: Conversation, of: (s: Conversation) => s},
		main: ({flags, inputs, send, machines}) =>
			Effect.gen(function* () {
				const agents = yield* Agents;
				if (!flags.folder.startsWith("/"))
					return yield* refused("--folder must be an absolute path");
				const answer = yield* config.reads(flags);

				const kept = yield* machines.conversation.get("conversation").start();
				const was = kept.getState();
				if (was.provider !== null && was.provider !== provider)
					return yield* refused(
						`this run's session is on ${was.provider}: it cannot move to ${provider}`,
					);
				const session = was.session ?? flags.session ?? `${provider}/${crypto.randomUUID()}`;
				if (was.session === null) yield* kept.dispatch({type: "opened", provider, session});
				const resumed = (yield* agents.knows(session)) !== null;
				const cutOff = Conversation.waiting(was);
				yield* send("started", {provider, session, resumed, resent: cutOff.length});

				const limits: Limits = {
					usd: flags.usd ?? null,
					tools: flags.tools ?? null,
					seconds: flags.seconds ?? null,
				};
				const turn = (prompt: string): Turn<A> => ({
					provider,
					session,
					folder: flags.folder,
					prompt,
					system: {_tag: "append", text: flags.system ?? ""},
					answer,
					model: flags.model ?? null,
					effort: flags.effort ?? null,
					limits,
				});

				// ---------------------------------------------------------------- cancels and asks
				/** The turn running now, so a cancel can reach it. */
				let running: {readonly n: number; readonly fiber: Fiber.Fiber<void, unknown>} | null = null;
				/** Turns cancelled before they began: each ends `cancelled` when it comes up. */
				const cancelled = new Set<number>();
				yield* Effect.forkScoped(
					inputs.cancel.pipe(
						Stream.runForEach((c) =>
							Effect.gen(function* () {
								const now = running;
								if (c === "now") {
									if (now !== null) yield* Effect.forkScoped(Fiber.interrupt(now.fiber));
									return;
								}
								if (now?.n === c) return yield* Effect.forkScoped(Fiber.interrupt(now.fiber));
								const seen = kept.getState().turns.find((t) => t.n === c);
								// A turn not told yet, or told and not ended: it is cancelled when it comes up.
								if (seen === undefined || seen.end === null) cancelled.add(c);
							}),
						),
					),
				);
				// Every ask is refused by the run's containment before anyone sees it (`dontAsk`, and Codex's
				// approvals `never`): nothing waits on a person, so an allow or refuse is said back, not lost.
				const notWaiting = (id: string) =>
					send("ask", {turn: null, id, title: "", answer: "not_waiting"});
				yield* Effect.forkScoped(inputs.allow.pipe(Stream.runForEach(notWaiting)));
				yield* Effect.forkScoped(inputs.refuse.pipe(Stream.runForEach(notWaiting)));

				// ---------------------------------------------------------------- the turns, one after another
				const todo = yield* Queue.unbounded<TurnSeen | null>();
				for (const t of cutOff) Queue.offerUnsafe(todo, t);
				yield* Effect.forkScoped(
					inputs.prompt.pipe(
						Stream.runForEach((prompt) =>
							Effect.gen(function* () {
								yield* kept.dispatch({type: "told", prompt});
								const told = kept.getState().turns.at(-1);
								if (told !== undefined) Queue.offerUnsafe(todo, told);
							}),
						),
						Effect.andThen(Queue.offer(todo, null)),
					),
				);

				const finish = (n: number, end: End & {readonly answer: A | null}) =>
					Effect.gen(function* () {
						yield* kept.dispatch({type: "ended", n, end});
						yield* send("ended", {turn: n, ...end});
					});

				const onHeard = (n: number, heard: Heard<A>, last: {ended: Ended<A> | null}) =>
					Effect.gen(function* () {
						if (heard._tag === "ended") {
							last.ended = heard;
							return;
						}
						yield* kept.dispatch({type: "heard", n, update: heard});
						if (heard._tag === "said") yield* send("said", {turn: n, text: heard.text});
						if (heard._tag === "tool")
							yield* send("tool", {
								turn: n,
								id: heard.id,
								title: heard.title,
								status: heard.status,
							});
						if (heard._tag === "asked")
							yield* send("ask", {turn: n, id: heard.id, title: heard.title, answer: "refused"});
					});

				const runTurn = (t: TurnSeen) =>
					Effect.gen(function* () {
						const began = yield* Clock.currentTimeMillis;
						const msSince = Effect.map(Clock.currentTimeMillis, (now) => Math.max(0, now - began));
						if (cancelled.has(t.n)) {
							cancelled.delete(t.n);
							return yield* finish(t.n, {
								...NO_END,
								stop: "cancelled",
								answer: null,
								ms: 0,
								error: null,
							});
						}
						yield* kept.dispatch({type: "began", n: t.n});
						const last: {ended: Ended<A> | null} = {ended: null};
						const fiber = yield* Effect.forkScoped(
							agents.run(turn(t.prompt)).pipe(Stream.runForEach((h) => onHeard(t.n, h, last))),
						);
						running = {n: t.n, fiber};
						const exit = yield* Fiber.await(fiber);
						running = null;
						const ms = yield* msSince;
						const e = last.ended;
						if (Exit.isSuccess(exit) && e !== null)
							return yield* finish(t.n, {
								stop: e.stop,
								answer: e.answer,
								tokens: e.tokens,
								counted: e.counted,
								usd: e.usd,
								requests: e.requests,
								ms,
								error: null,
							});
						// Interrupted only: a cancel, and the service's stop has run. Else the service failed the turn.
						if (Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause))
							return yield* finish(t.n, {
								...NO_END,
								stop: "cancelled",
								answer: null,
								ms,
								error: null,
							});
						const why = Exit.isFailure(exit) ? Cause.squash(exit.cause) : "no end";
						const error = why instanceof AgentFailed ? `${why.why}: ${why.message}` : String(why);
						return yield* finish(t.n, {...NO_END, stop: "failed", answer: null, ms, error});
					}).pipe(Effect.withSpan(`${provider} turn`, {attributes: {"agent.turn": t.n}}));

				for (;;) {
					const next = yield* Queue.take(todo);
					if (next === null) return;
					yield* runTurn(next);
				}
			}).pipe(Effect.scoped),
	});
}

const DESCRIPTION: Record<Provider, string> = {
	claude:
		"Claude Code as a program: each prompt is a turn on one session, through the Agents service.",
	codex: "Codex as a program: each prompt is a turn on one session, through the Agents service.",
};

/**
 * `claude` or `codex`, the program a person types: ways A and B. Its answer
 * is any JSON the agent ends with, or, with `--answer`, what that JSON Schema
 * reads.
 */
export const agentProgram = (provider: Provider) =>
	build({
		provider,
		name: provider,
		description: `${DESCRIPTION[provider]} With --answer, each turn ends with a JSON value that fits that JSON Schema, or null.`,
		flags: {
			...FLAGS,
			answer: flag(
				AnswerSchema,
				"The answer's JSON Schema. Left out: any JSON value the agent ends with, or null.",
			),
		},
		answer: Schema.Json,
		reads: (flags) =>
			flags.answer === undefined
				? Effect.succeed(Schema.Json)
				: // The importer answers a schema of any type; the shape check on `ended` is what holds it to JSON.
					Effect.map(readsFrom(flags.answer), (s) => s as Reads<Schema.Json>),
	});

/**
 * The same program with a stage's answer schema fixed at definition: way C.
 * Its `ended` carries `A | null`, so a misfit never crosses the boundary,
 * and the stage needs no second check. Not for tsh: a schema is code, not a flag.
 */
export const typedAgentProgram = <A>(
	provider: Provider,
	answer: Schema.Codec<A, A>,
	name: string = provider,
) =>
	build({
		provider,
		name,
		description: `${DESCRIPTION[provider]} Each turn ends with an answer of the stage's schema, or null.`,
		flags: FLAGS,
		answer,
		reads: () => Effect.succeed(answer),
	});

export const claudeProgram = agentProgram("claude");
export const codexProgram = agentProgram("codex");

/** The flags every agent program takes, the `answer` flag aside. */
export type AgentFlags = Given<typeof FLAGS>;

/** A typed agent program. */
export type TypedAgentProgram<A> = ReturnType<typeof typedAgentProgram<A>>;

/**
 * A Draft's runner on an agent program: the same three Msgs `agentRunner`
 * (../agent/draft.ts) gives, from a child run of the program instead of a
 * call on the service. A parent machine changes nothing. The child run lives
 * while the Sub is on: the Sub turned off stops the run, and its turn.
 *
 *   subscribe: {sort_run: (sub) => runner(sub.deps.run)}
 */
export const programRunner =
	<const N extends string, A>(config: {
		readonly name: N;
		readonly program: TypedAgentProgram<A>;
		readonly agents: typeof Agents.Service;
		readonly flags: (run: DraftRun) => AgentFlags;
		/** Where the child run keeps its conversation: under the parent's, in a host. */
		readonly keeping: (run: DraftRun) => Kept;
	}) =>
	(run: DraftRun): Stream.Stream<DraftMsg<N, A>> => {
		const {name} = config;
		const {key, id} = run;
		type Msg = DraftMsg<N, A>;
		const failedMsg = (error: string, spend: Spend): Msg =>
			({type: `${name}_failed`, key, id, error, spend}) as Msg;
		const none: Spend = {costUsd: 0, tokens: 0, context: 0, turns: 0, minutes: 0};
		return Stream.unwrap(
			Effect.gen(function* () {
				const out = yield* Queue.unbounded<Msg>();
				const tools = new Set<string>();
				const started = yield* start(
					config.program,
					config.flags(run),
					{
						// One Msg per tool call, at its first update, as `agentRunner` does.
						tool: (t) => {
							if (tools.has(t.id)) return;
							tools.add(t.id);
							Queue.offerUnsafe(out, {type: `${name}_tool`, key, id, tool: t.title} as Msg);
						},
						ended: (e) => {
							const spend = End.toSpend(e);
							Queue.offerUnsafe(
								out,
								e.stop === "end_turn"
									? ({
											type: `${name}_finished`,
											key,
											id,
											output: e.answer,
											session: run.session.id,
											spend,
										} as Msg)
									: failedMsg(e.error ?? e.stop, spend),
							);
						},
					},
					config.keeping(run),
				).pipe(Effect.provideService(Agents, config.agents));
				if (started.kind !== "running")
					return Stream.make(
						failedMsg(`the agent program refused ${started.name}: ${started.why}`, none),
					);
				// A run that ends with no turn's end (refused at start) still ends the Draft.
				yield* Effect.forkScoped(
					started.run.ended.pipe(
						Effect.flatMap((ended) =>
							Queue.offer(out, failedMsg(`the agent program ${ended.kind} with no answer`, none)),
						),
					),
				);
				// A fresh run's line is empty: one value never finds it full.
				yield* tell(started.run, "prompt", run.prompt).pipe(Effect.orDie);
				// Stdin's end: one prompt, then the run ends after its turn, as `claude -p` does.
				started.close("prompt");
				return Stream.fromQueue(out).pipe(Stream.takeUntil((m) => m.type !== `${name}_tool`));
			}),
		);
	};
