import {Effect, Queue, type Schema, Stream} from "effect";
import {type Kept, type Program, start, tell} from "../../program/program.ts";
import {Agents} from "../agent/turn.ts";
import type {DraftMsg, DraftRun, Spend} from "../claude/draft.ts";
import type {AgentFlags, chat, flags, inputs, outputs} from "./chat.ts";
import {type conversationKind, End} from "./conversation.ts";

// A Draft's runner on an agent program (experiment 169): the same three Msgs
// `agentRunner` (../agent/draft.ts) gives, from a child run of `claude` or
// `codex` instead of a call on the service. A parent machine changes nothing
// but one line: it decodes the answer when it arrives, since the program
// hands on plain JSON (`decoder` in the pipeline).
//
//   const sorted = decoder(SortReply);
//   const runner = programRunner({name: "sort", program: claude, agents, flags, keeping});
//   subscribe: {sort_run: (sub) => runner(sub.deps.run).pipe(Stream.map(sorted.decode))}
//
// The child run lives while the Sub is on: the Sub turned off stops the run, and its turn.

/** What `claude` and `codex` are, as `defineProgram` made them: their main is `chat`. */
type AgentProgram = Program<
	typeof flags,
	typeof inputs,
	typeof outputs,
	{conversation: typeof conversationKind},
	Effect.Error<ReturnType<typeof chat>>,
	Effect.Services<ReturnType<typeof chat>>
>;

export const programRunner =
	<const N extends string>(config: {
		readonly name: N;
		readonly program: AgentProgram;
		readonly agents: typeof Agents.Service;
		/** The child run's flags: the stage's JSON Schema goes in `schema`. */
		readonly flags: (run: DraftRun) => AgentFlags;
		/** Where the child run keeps its conversation: under the parent's, in a host. */
		readonly keeping: (run: DraftRun) => Kept;
	}) =>
	(run: DraftRun): Stream.Stream<DraftMsg<N, Schema.Json>> => {
		const {name} = config;
		const {key, id} = run;
		type Msg = DraftMsg<N, Schema.Json>;
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
