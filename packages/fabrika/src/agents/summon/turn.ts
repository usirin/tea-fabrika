import {Clock, Effect, Schema, Stream} from "effect";
import {defineProgram, fork} from "../../program/program.ts";
import {flag, input, output} from "../../program/shape.ts";
import {SummonManager, type SummonRefused} from "../../shell/summon.ts";

// `turn`: one turn of a summoned agent, as one job. tsh makes a said line into it, so a turn is
// a job like any other: in the foreground it holds the prompt, Ctrl-C stops it, and `jobs` lists
// it. The agent is not the job: it keeps running in the host's `SummonManager` between turns.
//
//   tsh$ @scout why does post print #7 twice?
//   // the line tsh runs: turn --to scout prompt="why does post print #7 twice?"
//   ✦ scout  reading Read a.txt · 1 tool · 2s           status: in place, never printed
//   scout asks: Write written.txt  allow? [y/N]          ask: the person's y tells `allow`
//   ✦ scout  It formats the number in two places ...    said: the reply, once, whole
//   scout · turn 3 · 14s                                 result
//   ^C                                                   the turn is cancelled; scout stays
//
// It is a listed program, so `turn --to scout prompt="..."` is a line a script can type too.

const Count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

const Status = Schema.Struct({name: Schema.String, text: Schema.String});
const Said = Schema.Struct({name: Schema.String, text: Schema.String});
const Asked = Schema.Struct({
	name: Schema.String,
	ask: Schema.String,
	title: Schema.String,
	answer: Schema.Literals(["waiting", "allowed", "refused"]),
});
const Result = Schema.Struct({
	name: Schema.String,
	/** The number the agent gave the prompt. `null`: it was cancelled before it had one. */
	turn: Schema.NullOr(Count),
	stop: Schema.String,
	ms: Count,
	/** The session's dollars so far, when the harness says them. */
	cost: Schema.NullOr(Schema.Finite),
});

const seconds = (ms: number) => `${Math.round(ms / 1000)}s`;

/** A result in a person's words: a cancel says so, an end says the turn and how long. */
const resultLine = (r: typeof Result.Type): string =>
	r.stop === "cancelled"
		? `${r.name}: turn cancelled`
		: `${r.name} · ${r.turn === null ? "" : `turn ${r.turn} · `}${seconds(r.ms)}${r.stop === "end_turn" ? "" : ` · ${r.stop.replaceAll("_", " ")}`}`;

export const turnProgram = defineProgram({
	name: "turn",
	description:
		"One turn of a summoned agent: tells it a prompt, shows where it is, asks the person what it asks, and prints its reply once, whole. Stopped, it cancels the turn; the agent stays.",
	flags: {
		to: flag(Schema.String, "The summoned agent's name."),
	},
	inputs: {
		prompt: input(Schema.String, "What to tell the agent, as typed: one turn."),
		allow: input(
			Schema.Struct({ask: Schema.String, allow: Schema.Boolean}),
			"The person's answer to an ask the agent waits on: allow it once, or refuse it. A person only.",
			{control: true, personOnly: true},
		),
	},
	outputs: {
		told: output(
			Schema.Struct({name: Schema.String, turn: Count}),
			"The number the agent gave the prompt.",
			{person: "none"},
		),
		status: output(Status, "Where the turn is: shown in place while it works.", {
			person: {status: (s) => `✦ ${s.name}  ${s.text}`},
		}),
		ask: output(Asked, "A permission the agent waits on, as it comes and as it is answered.", {
			person: {
				ask: (a) =>
					a.answer === "waiting" ? {id: a.ask, text: `${a.name} asks: ${a.title}`} : null,
				answer: "allow",
			},
		}),
		said: output(Said, "The agent's reply, once the turn ended: whole, never in pieces.", {
			person: {line: (s) => `✦ ${s.name}  ${s.text}`, announce: true},
		}),
		result: output(Result, "How the turn ended, how long it took, and its dollars so far.", {
			person: {line: resultLine},
		}),
	},
	main: ({flags, serve, send}) =>
		Effect.gen(function* () {
			const manager = yield* SummonManager;
			const name = flags.to;
			/** Each ask's title, for its answer's line. */
			const titles = new Map<string, string>();

			const one = (prompt: string): Effect.Effect<void, SummonRefused> =>
				Effect.gen(function* () {
					const began = yield* Clock.currentTimeMillis;
					let turn: number | null = null;
					let over = false;
					const since = Effect.map(Clock.currentTimeMillis, (now) => Math.max(0, now - began));
					yield* manager.turn(name, prompt, null).pipe(
						Stream.runForEach((news) => {
							switch (news._tag) {
								case "told":
									turn = news.turn;
									return send("told", {name, turn: news.turn});
								case "status":
									return send("status", {name, text: news.text});
								case "ask":
									titles.set(news.ask, news.title);
									return send("ask", {name, ask: news.ask, title: news.title, answer: "waiting"});
								case "said":
									return send("said", {name, text: news.text});
								case "result":
									over = true;
									return send("result", {
										name,
										turn,
										stop: news.stop,
										ms: Math.max(0, Math.round(news.ms)),
										cost: news.cost,
									});
							}
						}),
						// Stopped (Ctrl-C, `stop %n`): the turn is cancelled, not the agent.
						Effect.onInterrupt(() =>
							over
								? Effect.void
								: manager.cancel(name).pipe(
										Effect.andThen(since),
										Effect.flatMap((ms) =>
											send("result", {name, turn, stop: "cancelled", ms, cost: null}),
										),
									),
						),
					);
				});

			yield* serve(
				{
					prompt: one,
					allow: fork(({ask, allow}) =>
						manager.answer(name, ask, allow).pipe(
							Effect.andThen(
								send("ask", {
									name,
									ask,
									title: titles.get(ask) ?? "",
									answer: allow ? "allowed" : "refused",
								}),
							),
						),
					),
				},
				{until: ["prompt"]},
			);
		}),
});
