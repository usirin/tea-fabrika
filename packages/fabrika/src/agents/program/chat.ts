import {
	Cause,
	Clock,
	Effect,
	Exit,
	Fiber,
	JsonSchema,
	Schema,
	SchemaRepresentation,
	Stream,
} from "effect";
import {fork, type Given, type Io} from "../../program/program.ts";
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
import type {Reads} from "../claude/schema.ts";
import {
	Conversation,
	type conversationKind,
	type End,
	EndStop,
	Provider,
	type TurnSeen,
} from "./conversation.ts";

// What the `claude` and `codex` programs share (experiment 169): their flags,
// inputs and outputs, and `chat`, the main both run. Each program is its own
// package in `programs/`, with one `defineProgram` named after itself; it
// wires these, and `conversationKind`, the way `trace` wires its machine.
// Nothing here makes a program.
//
//   claude --folder /tmp/s prompt="what is 2+3?"      a turn; `said`, `tool`, then `ended`
//   tell %1 prompt "and times 4?"                     the next turn, on the same session
//   tell %1 cancel 2                                  turn 2, cancelled: now, or when it comes up
//   tell %1 cancel now                                whatever turn runs now
//
// The program never knows whether a person watches. It runs each prompt as a
// turn until its `prompt` input closes, then ends. The run's mailbox is the
// line of prompts: a prompt told while a turn runs waits there, in the order
// told, and past the program's capacity a tell fails `MailboxFull`. A cancel
// is a control input, as tsh's Ctrl-C is: it is handled at once while a turn
// runs, and a mailbox full of prompts never refuses it. A tile keeps that input
// open, which is a chat; a parent tells one prompt and closes it, which is
// `claude -p` or `codex exec`. Its window is its view, the kept
// conversation; whether a host draws it is the host's call (the write-up's
// isatty section).
//
// The answer is a plain JSON value. With `--schema`, a JSON Schema, the
// provider is held to it and the service reads by it, as `claude -p
// --json-schema` and `codex exec --output-schema` do. The stage that asked
// decodes the answer with its own Effect schema when it arrives, so a check
// JSON Schema cannot say still holds there.

/** Why the program would not go on. */
export interface AgentRefused {
	readonly _tag: "agent_refused";
	readonly message: string;
}
const refused = (message: string) => Effect.fail<AgentRefused>({_tag: "agent_refused", message});

const Count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
const Positive = Schema.Finite.check(Schema.isGreaterThan(0));

/** A cancel names a turn, or says `now`: whatever runs when it is read. */
const Cancel = Schema.Union([Count, Schema.Literal("now")]);

/** A JSON Schema, as a flag holds it. */
const JsonObject = Schema.Record(Schema.String, Schema.Json);

/** The flags of both programs. */
export const flags = {
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
	schema: flag(
		Schema.UndefinedOr(JsonObject),
		"The answer's JSON Schema: each turn ends with a JSON value that fits it, or null. Left out: any JSON value the agent ends with, or null.",
	),
};

/** The flags as `main` is given them. */
export type AgentFlags = Given<typeof flags>;

/** The inputs of both programs. */
export const inputs = {
	prompt: input(Schema.String, "A prompt: one turn, after the turns before it."),
	cancel: input(
		Cancel,
		"A turn's number, or now: that turn is cancelled. Handled at once, while a turn runs.",
		{control: true},
	),
};

const Started = Schema.Struct({
	provider: Provider,
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
/**
 * A permission ask a turn made. The run's containment refuses it at once, so the answer is
 * always `refused`. No input answers an ask: a person's answer is a fact from their own session
 * (docs/direction/one-ask-and-one-meter.md, proposed), and any program in a pipe can tell an input.
 */
const AskOut = Schema.Struct({
	turn: Count,
	id: Schema.String,
	title: Schema.String,
	answer: Schema.Literal("refused"),
});
const EndedOut = Schema.Struct({
	turn: Count,
	stop: EndStop,
	/** A plain JSON value: the stage that asked decodes it with its own schema. */
	answer: Schema.NullOr(Schema.Json),
	tokens: Tokens,
	counted: Counted,
	usd: Schema.NullOr(Schema.Finite),
	requests: Schema.NullOr(Count),
	ms: Count,
	error: Schema.NullOr(Schema.String),
});

/** The outputs of both programs. */
export const outputs = {
	started: output(Started, "Once per start: our session, and whether the provider carries it on."),
	said: output(Said, "One whole message the agent said in a turn."),
	tool: output(Tool, "A tool call, as it starts and as it ends."),
	ask: output(AskOut, "A permission ask a turn made, refused at once by the run's containment."),
	ended: output(
		EndedOut,
		"Each turn's end: why it stopped, its answer as JSON or null, its tokens and dollars.",
	),
};

/** A JSON Schema handed in as data, as a schema the service reads by. Effect's own importer. */
const readsFrom = (json: Readonly<Record<string, Schema.Json>>) =>
	Effect.try({
		try: () =>
			// The importer answers a schema of any type; the shape check on `ended` holds it to JSON.
			SchemaRepresentation.fromJsonSchemaDocument(
				JsonSchema.fromSchemaDraft2020_12(json as JsonSchema.JsonSchema),
			) as Reads<Schema.Json>,
		catch: (e) =>
			({
				_tag: "agent_refused",
				message: `--schema is no JSON Schema: ${String(e)}`,
			}) as AgentRefused,
	});

const NO_END = {
	tokens: {input: 0, cached: 0, output: 0},
	counted: "none",
	usd: null,
	requests: null,
} as const;

/**
 * The main of an agent program, on `provider`: each prompt a turn on one
 * session, through the `Agents` service, until `prompt` closes.
 *
 *   main: (io) => chat("claude", io)
 */
export const chat = (
	provider: Provider,
	io: Io<typeof flags, typeof inputs, typeof outputs, {conversation: typeof conversationKind}>,
) =>
	Effect.gen(function* () {
		const {send} = io;
		const given = io.flags;
		const agents = yield* Agents;
		if (!given.folder.startsWith("/")) return yield* refused("--folder must be an absolute path");
		const answer = given.schema === undefined ? Schema.Json : yield* readsFrom(given.schema);

		const kept = yield* io.machines.conversation.get("conversation").start();
		const was = kept.getState();
		if (was.provider !== null && was.provider !== provider)
			return yield* refused(
				`this run's session is on ${was.provider}: it cannot move to ${provider}`,
			);
		const session = was.session ?? given.session ?? `${provider}/${crypto.randomUUID()}`;
		if (was.session === null) yield* kept.dispatch({type: "opened", provider, session});
		const resumed = (yield* agents.knows(session)) !== null;
		const cutOff = Conversation.waiting(was);
		yield* send("started", {provider, session, resumed, resent: cutOff.length});

		const limits: Limits = {
			usd: given.usd ?? null,
			tools: given.tools ?? null,
			seconds: given.seconds ?? null,
		};
		const turn = (prompt: string): Turn<Schema.Json> => ({
			provider,
			session,
			folder: given.folder,
			prompt,
			system: {_tag: "append", text: given.system ?? ""},
			answer,
			model: given.model ?? null,
			effort: given.effort ?? null,
			limits,
		});

		// ---------------------------------------------------------------- cancels
		/** The turn running now, so a cancel can reach it. */
		let running: {readonly n: number; readonly fiber: Fiber.Fiber<void, unknown>} | null = null;
		/** Turns cancelled before they began: each ends `cancelled` when it comes up. */
		const cancelled = new Set<number>();
		/** A cancel, read at once: the turn running now is stopped, and a later one when it comes up. */
		const cancel = (c: typeof Cancel.Type) =>
			Effect.gen(function* () {
				const now = running;
				if (c === "now" || now?.n === c) {
					if (now !== null) yield* Effect.forkScoped(Fiber.interrupt(now.fiber));
					return;
				}
				const seen = kept.getState().turns.find((t) => t.n === c);
				// A turn not told yet, or told and not ended: it is cancelled when it comes up.
				if (seen === undefined || seen.end === null) cancelled.add(c);
			});
		const finish = (n: number, end: End) =>
			Effect.gen(function* () {
				yield* kept.dispatch({type: "ended", n, end});
				yield* send("ended", {turn: n, ...end});
			});

		const onHeard = (
			n: number,
			heard: Heard<Schema.Json>,
			last: {ended: Ended<Schema.Json> | null},
		) =>
			Effect.gen(function* () {
				if (heard._tag === "ended") {
					last.ended = heard;
					return;
				}
				yield* kept.dispatch({type: "heard", n, update: heard});
				if (heard._tag === "said") yield* send("said", {turn: n, text: heard.text});
				if (heard._tag === "tool")
					yield* send("tool", {turn: n, id: heard.id, title: heard.title, status: heard.status});
				// Every ask is refused by the run's containment before anyone sees it (`dontAsk`, and
				// Codex's approvals `never`): nothing waits on a person.
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
				const last: {ended: Ended<Schema.Json> | null} = {ended: null};
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

		// ---------------------------------------------------------------- the turns, one after another
		// A turn a kill cut off runs again first, while the mailbox is served, so a cancel reaches it.
		const again = yield* Effect.forkScoped(
			Effect.forEach(cutOff, runTurn, {concurrency: 1, discard: true}),
		);
		const handlers = {
			// The turn runs in the handler: every prompt told meanwhile waits in the mailbox.
			prompt: (prompt: string) =>
				Effect.gen(function* () {
					yield* Fiber.join(again);
					yield* kept.dispatch({type: "told", prompt});
					const told = kept.getState().turns.at(-1);
					if (told !== undefined) yield* runTurn(told);
				}),
			cancel: fork(cancel),
		};
		yield* io.serve(handlers, {until: ["prompt"]});
		// `prompt` closed while the cut-off turn still runs: go on serving until it ends.
		yield* Effect.raceFirst(Fiber.join(again), Effect.andThen(io.serve(handlers), Effect.never));
	}).pipe(Effect.scoped);
