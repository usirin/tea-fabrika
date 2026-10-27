import type {Sub} from "@demlik/tea";
import {Clock, Effect, Stream} from "effect";
import type {DraftMsg, DraftRun, Spend} from "../claude/draft.ts";
import type {Agents, Ended, Turn} from "./turn.ts";

// A Draft on the interface: the same Sub and the same three Msgs a Draft has
// today (../claude/draft.ts), with the stream coming from `Agents` and not
// from one maker's SDK. A parent machine changes nothing: it names the run as
// data, hears `<name>_tool`, `<name>_finished` or `<name>_failed`, and leaving
// the phase turns the Sub off, which is the stop.
//
//   const runner = agentRunner("builder", agents, (run) => ({
//     provider: settings.provider, session: run.session.id, folder: tree,
//     prompt: run.prompt, answer: Built, model, effort, limits,
//   }));
//
// Imports from ../claude/draft.ts are types only: this file names no maker.

const spendOf = <A>(ended: Ended<A> | null, minutes: number): Spend => ({
	costUsd: ended?.usd ?? 0,
	tokens: ended === null ? 0 : ended.tokens.input + ended.tokens.output,
	context: 0,
	turns: ended?.requests ?? 0,
	minutes,
});

export const agentRunner =
	<N extends string, O>(
		name: N,
		agents: typeof Agents.Service,
		turnOf: (run: DraftRun) => Turn<O>,
	) =>
	(sub: Sub<N, DraftRun>): Stream.Stream<DraftMsg<N, O>> => {
		const run = sub.deps;
		const {key, id} = run;
		return Stream.unwrap(
			Effect.gen(function* () {
				const began = yield* Clock.currentTimeMillis;
				const tools = new Set<string>();
				const minutes = Effect.map(Clock.currentTimeMillis, (now) => (now - began) / 60_000);
				return agents.run(turnOf(run)).pipe(
					Stream.mapEffect((heard) =>
						Effect.gen(function* () {
							// One Msg per tool call, at its first update: its later ones are the same call.
							if (heard._tag === "tool") {
								if (tools.has(heard.id)) return [];
								tools.add(heard.id);
								return [{type: `${name}_tool`, key, id, tool: heard.title} as DraftMsg<N, O>];
							}
							if (heard._tag !== "ended") return [];
							const spend = spendOf(heard, yield* minutes);
							return [
								heard.stop === "end_turn"
									? ({
											type: `${name}_finished`,
											key,
											id,
											output: heard.answer,
											session: run.session.id,
											spend,
										} as DraftMsg<N, O>)
									: ({type: `${name}_failed`, key, id, error: heard.stop, spend} as DraftMsg<N, O>),
							];
						}),
					),
					Stream.flattenIterable,
					Stream.catch((error) =>
						Stream.fromEffect(
							Effect.map(
								minutes,
								(m) =>
									({
										type: `${name}_failed`,
										key,
										id,
										error: `${error.why}: ${error.message}`,
										spend: spendOf(null, m),
									}) as DraftMsg<N, O>,
							),
						),
					),
				);
			}),
		);
	};
