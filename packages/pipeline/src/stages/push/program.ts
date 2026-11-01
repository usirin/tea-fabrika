import {defineProgram, input, kind, output, type RefsOf} from "@kampus/fabrika-old";
import {Context, Effect, Schema} from "effect";
import type {Post} from "../operate/machine.ts";
import {nameOf} from "../outcome.ts";
import {
	type openPull,
	type postReviews,
	Push,
	PushAsk,
	PushOutcome,
	type pushHead,
	push,
} from "./machine.ts";

// The push step as a program. Nothing before it leaves the machine. Whoever starts it provides
// `PushWork`, whose three writes each find their own first try.

type Failed = {readonly _tag: "unknown"};

export class PushWork extends Context.Service<
	PushWork,
	{
		readonly push: (ticket: string, number: number, head: string) => Effect.Effect<null, Failed>;
		readonly open: (
			ticket: string,
			number: number,
			head: string,
			title: string,
			body: string,
		) => Effect.Effect<string, Failed>;
		readonly post: (
			pr: string,
			head: string,
			posts: readonly Post[],
		) => Effect.Effect<null, Failed>;
	}
>()("PushWork") {}

const base = {
	machine: push,
	state: Push,
	options: () => ({
		ctx: undefined,
		interpret: {
			push_head: (cmd: ReturnType<typeof pushHead>) =>
				Effect.gen(function* () {
					return yield* (yield* PushWork).push(cmd.ticket, cmd.number, cmd.head);
				}),
			push_open: (cmd: ReturnType<typeof openPull>) =>
				Effect.gen(function* () {
					return yield* (yield* PushWork).open(
						cmd.ticket,
						cmd.number,
						cmd.head,
						cmd.title,
						cmd.body,
					);
				}),
			push_post: (cmd: ReturnType<typeof postReviews>) =>
				Effect.gen(function* () {
					return yield* (yield* PushWork).post(cmd.pr, cmd.head, cmd.posts);
				}),
		},
		terminal: (s: Push) => s.phase === "over",
	}),
	recovered: (s: Push) => (s.phase === "idle" ? null : ({type: "resume"} as const)),
	drawing: () => ({
		name: "push",
		service: "push",
		steps: {push_head: "push branch", push_open: "open pull request", push_post: "post verdicts"},
	}),
	status: (s: Push) => (s.phase === "over" ? nameOf(s.outcome) : s.phase),
};

export const pushKind = kind({...base, parent: "main"});
export const pushChild = kind({...base, parent: "lane"});

/** One push run to its end, under `id`. Found mid-way, it goes on. */
export const pushToTheEnd = (
	refs: RefsOf<typeof pushChild> | RefsOf<typeof pushKind>,
	id: string,
	ask: PushAsk,
) =>
	Effect.gen(function* () {
		const runtime = yield* refs.get(id).start({type: "start", ask}, {conflict: "use_existing"});
		const end = yield* runtime.done();
		if (end.phase !== "over") return yield* Effect.die(`the push stopped in ${end.phase}`);
		return end;
	}).pipe(Effect.scoped);

export const pushProgram = defineProgram({
	name: "push",
	description:
		"Puts a reviewed head on the remote: the branch, the pull request, and the review's verdicts on it.",
	flags: {},
	inputs: {ask: input(PushAsk, "The head one review passed, and its verdicts.")},
	outputs: {
		ended: output(
			Schema.Struct({outcome: PushOutcome, name: Schema.String}),
			"Once per ask: how it ended.",
		),
	},
	machines: {push: pushKind},
	main: ({serve, send, machines}) =>
		serve({
			ask: (ask) =>
				Effect.gen(function* () {
					const id = `push/${ask.ticket}/${ask.head}`;
					const end = yield* pushToTheEnd(machines.push, id, ask);
					yield* send("ended", {outcome: end.outcome, name: nameOf(end.outcome)});
					yield* machines.push.get(id).clear;
				}),
		}),
});
