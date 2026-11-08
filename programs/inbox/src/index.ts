import type {EffectInterpret} from "@demlik/tea/effect";
import {defineProgram, input, kind} from "@kampus/fabrika-old";
import {Effect, Schema} from "effect";
import {InboxState, inboxMachine, type InboxCommand, type InboxMsg} from "./inbox.ts";
import {InboxRuntime} from "./runtime.ts";

export const INBOX_COMMANDS = {
	next: {name: "Next", send: {type: "move", value: 1}, keys: ["j", "arrowdown"]},
	previous: {name: "Previous", send: {type: "move", value: -1}, keys: ["k", "arrowup"]},
	open: {name: "Open all", send: {type: "open", value: null}, keys: "shift+o"},
	look: {name: "Look", send: {type: "look", value: null}, keys: "space"},
	reply: {name: "Reply", send: {type: "reply", value: null}, keys: "r"},
	later: {name: "Later", send: {type: "later", value: null}, keys: "h"},
};
const view = {machine: "inbox" as const, data: InboxState, of: (s: InboxState) => s};
const interpret = {
	reply_send: (cmd) =>
		Effect.flatMap(InboxRuntime, (runtime) => runtime.deliver(cmd)).pipe(
			Effect.mapError((error) => ({_tag: error._tag, why: error.why})),
		),
	open: (cmd) =>
		Effect.flatMap(InboxRuntime, (runtime) => runtime.open(cmd.row)).pipe(Effect.as(null)),
	leave: () => Effect.flatMap(InboxRuntime, (runtime) => runtime.leave).pipe(Effect.as(null)),
} satisfies EffectInterpret<InboxMsg, InboxCommand, InboxRuntime>;
const inboxOptions = {ctx: undefined, interpret};
export const inbox = defineProgram({
	name: "inbox",
	description: "Your turn and messages, shared by the glance and tile.",
	inputs: {
		move: input(Schema.Number, "Move selection."),
		select: input(Schema.String, "Select a row."),
		open: input(Schema.Null, "Open the inbox tile."),
		enter: input(Schema.Null, "Open this item."),
		look: input(Schema.Null, "Unfold this row."),
		reply: input(Schema.Null, "Reply to this message."),
		change: input(Schema.String, "Edit the reply."),
		send: input(Schema.Struct({id: Schema.String, said: Schema.Finite}), "Send the reply."),
		retry: input(Schema.Null, "Retry the same reply."),
		escape: input(Schema.Null, "Close one layer."),
		later: input(Schema.Null, "Set aside or bring back this row."),
		seen: input(Schema.Null, "Mark the rows seen."),
	},
	outputs: {},
	commands: INBOX_COMMANDS,
	machines: {
		inbox: kind({
			machine: inboxMachine,
			state: InboxState,
			parent: "main",
			options: () => inboxOptions,
			drawing: () => ({
				name: "inbox",
				steps: {reply_send: "send a reply", open: "open the inbox", leave: "leave the inbox"},
			}),
			status: (s) => `${s.rows.length} inbox items`,
		}),
	},
	view,
	glance: view,
	main: ({serve, watch}) =>
		Effect.gen(function* () {
			const runtime = yield* InboxRuntime;
			yield* watch("inbox", "recipient", runtime);
			yield* serve({
				move: (value) => runtime.send({type: "move", value}),
				select: (value) => runtime.send({type: "select", value}),
				open: (value) => runtime.send({type: "open", value}),
				enter: (value) => runtime.send({type: "enter", value}),
				look: (value) => runtime.send({type: "look", value}),
				reply: (value) => runtime.send({type: "reply", value}),
				change: (value) => runtime.send({type: "change", value}),
				send: (value) => runtime.send({type: "send", value}),
				retry: (value) => runtime.send({type: "retry", value}),
				escape: (value) => runtime.send({type: "escape", value}),
				later: (value) => runtime.send({type: "later", value}),
				seen: (value) => runtime.send({type: "seen", value}),
			});
		}).pipe(Effect.scoped),
});
