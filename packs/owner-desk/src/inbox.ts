import {defineMachine} from "@demlik/tea";
import {kind} from "@tea-fabrika/tea-program";
import type {Ask} from "@tea-fabrika/wip/asks/ask";

// The owner's inbox: what waits on the owner, oldest first, and the last
// answer of theirs the core refused for each, as one small machine. Pure:
// showing it is the program's job (./program.ts), as Elm's view is the
// runtime's.

export interface Inbox {
	readonly open: readonly Ask[];
	/** For an open ask, why the core refused the owner's last answer to it. */
	readonly refused: Readonly<Record<string, string>>;
}

export type InboxMsg =
	/** One ask, as the core said it. Heard again (the core says every open ask at its start), it changes nothing. */
	| {readonly type: "asked"; readonly ask: Ask}
	/** The core took an answer: the ask leaves the inbox. */
	| {readonly type: "settled"; readonly id: string}
	| {readonly type: "refused"; readonly id: string; readonly why: string};

const without = (refused: Inbox["refused"], id: string) =>
	Object.fromEntries(Object.entries(refused).filter(([key]) => key !== id));

export const inbox = defineMachine({
	types: {model: {} as Inbox, msg: {} as InboxMsg, ctx: undefined},
	cmds: [],
	init: (loaded) => [{open: loaded?.open ?? [], refused: loaded?.refused ?? {}}, []],
	update: {
		asked: (s, m) => [
			s.open.some((ask) => ask.id === m.ask.id)
				? s
				: {...s, open: [...s.open, m.ask].sort((a, b) => a.at - b.at)},
			[],
		],
		settled: (s, m) => [
			{open: s.open.filter((ask) => ask.id !== m.id), refused: without(s.refused, m.id)},
			[],
		],
		refused: (s, m) => [
			s.open.some((ask) => ask.id === m.id) ? {...s, refused: {...s.refused, [m.id]: m.why}} : s,
			[],
		],
	},
});

export const inboxKind = kind({
	machine: inbox,
	parent: "main",
	options: () => ({ctx: undefined}),
	drawing: () => ({name: "inbox", steps: {}, tags: (s) => ({waiting: s.open.length})}),
	status: (s) =>
		s.open.length === 0 ? "nothing waits on the owner" : `${s.open.length} waiting on the owner`,
});
