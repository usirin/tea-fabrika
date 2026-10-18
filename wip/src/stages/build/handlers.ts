import {Effect, Option, Schema, Stream} from "effect";
import {type BuildDrafted, Builder, Built, type Ran} from "./form";
import type {BuildMsg, copyTree, openPr, pushBranch, RunSub, readTicket} from "./machine";
import {BuildHost, BuildWrites} from "./services";

// What answers the build machine's Cmds and runs its Sub, kept by what each
// may do:
//
//   buildReadInterpret   the one read: the ticket. It needs `BuildHost`.
//   buildWriteInterpret  the three writes. It needs `BuildWrites`, and is made
//                        by a call, so a run that never makes it has no write.
//   buildSubscribe       the builder's run.

export const buildReadInterpret = {
	build_ticket: (cmd: ReturnType<typeof readTicket>) =>
		Effect.gen(function* () {
			return yield* (yield* BuildHost).ticket(cmd.ticket, cmd.number);
		}),
};

export const buildWriteInterpret = () => ({
	build_copy: (cmd: ReturnType<typeof copyTree>) =>
		Effect.gen(function* () {
			return yield* (yield* BuildWrites).copy(cmd.ticket, cmd.number);
		}),
	build_push: (cmd: ReturnType<typeof pushBranch>) =>
		Effect.gen(function* () {
			return yield* (yield* BuildWrites).push(cmd.ticket, cmd.copied, cmd.message);
		}),
	build_open: (cmd: ReturnType<typeof openPr>) =>
		Effect.gen(function* () {
			return yield* (yield* BuildWrites).open(cmd.ticket, cmd.number, cmd.title, cmd.body);
		}),
});

const ranOf = (drafted: BuildDrafted): Ran => ({
	spend: drafted.spend,
	tools: drafted.tools,
	refused: drafted.refused,
	links: drafted.links,
});

/**
 * How a run ended, as the machine's Msg. A Msg from a Sub is not checked by
 * tea the way a Cmd's answer is, so the form is read against its schema here:
 * one that does not fit is `misfit`, never a Msg the machine would trust.
 */
export const msgOf =
	(at: {readonly ticket: string; readonly round: number; readonly run: number}) =>
	(drafted: BuildDrafted): BuildMsg => {
		const ran = ranOf(drafted);
		switch (drafted.answer) {
			case "built": {
				const built = Schema.decodeUnknownOption(Built)(drafted.built);
				return Option.isSome(built)
					? {type: "build_built", ...at, built: built.value, ran}
					: {type: "build_failed", ...at, why: "misfit", error: null, ran};
			}
			case "misfit":
			case "over_budget":
				return {type: "build_failed", ...at, why: drafted.answer, error: null, ran};
			case "broke":
				return {type: "build_failed", ...at, why: "broke", error: drafted.error, ran};
		}
	};

export const buildSubscribe = {
	/** The builder's run, as long as the Sub is on. When it closes, the run is interrupted, and the agent with it. */
	build_run: (sub: RunSub): Stream.Stream<BuildMsg, never, Builder> =>
		Stream.fromEffect(
			Effect.gen(function* () {
				return yield* (yield* Builder).build(sub.deps.brief, sub.deps.settings);
			}),
		).pipe(Stream.map(msgOf({ticket: sub.deps.ticket, round: sub.deps.round, run: sub.deps.run}))),
};
