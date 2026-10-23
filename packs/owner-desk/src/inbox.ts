import {defineMachine} from "@demlik/tea";
import {kind} from "@kampus/fabrika";
import type {AnswerBody, Ask} from "@kampus/pipeline/asks/ask";
import {askPage, inboxPage, type Page, saidOf} from "./pages.ts";

// The owner's desk as one small machine: what waits on the owner, oldest
// first; the last answer of theirs the core refused, for each; and each ask
// that stopped waiting, with what was said. Pure. Its pages are a function
// of it (`pagesOf`), as Elm's view is of the model; the program shows the
// ones that changed (./program.ts).

/** An ask that no longer waits, and what closed it. */
export interface Closed {
	readonly ask: Ask;
	readonly said: string;
}

export interface Desk {
	readonly open: readonly Ask[];
	/** For an open ask, why the core refused the owner's last answer to it. */
	readonly refused: Readonly<Record<string, string>>;
	/** Every ask that stopped waiting while the desk ran, by id. An ask's id is never used again. */
	readonly closed: Readonly<Record<string, Closed>>;
}

export type DeskMsg =
	/**
	 * The core's whole list of what waits, which replaces this one. Not each
	 * new ask: an ask can stop waiting with no answer the desk heard (a newer
	 * plan version, an answer taken while the desk was off), and a list built
	 * from events keeps it forever (experiment 89's red).
	 */
	| {readonly type: "waiting"; readonly asks: readonly Ask[]}
	/** The core took an answer. */
	| {readonly type: "settled"; readonly ask: Ask; readonly answer: AnswerBody}
	| {readonly type: "refused"; readonly id: string; readonly why: string};

/** What a closed page says of an ask that stopped waiting with no answer the desk heard. */
export const GONE = "no longer waiting: a newer version came, or it was answered elsewhere";

const keep = <V>(record: Readonly<Record<string, V>>, test: (id: string) => boolean) =>
	Object.fromEntries(Object.entries(record).filter(([id]) => test(id)));

export const desk = defineMachine({
	types: {model: {} as Desk, msg: {} as DeskMsg, ctx: undefined},
	cmds: [],
	init: (loaded) => [
		{open: loaded?.open ?? [], refused: loaded?.refused ?? {}, closed: loaded?.closed ?? {}},
		[],
	],
	update: {
		waiting: (s, m) => {
			// Inputs are read side by side, so a list said before an answer can come after it: an ask once closed stays closed.
			const open = m.asks
				.filter((ask) => s.closed[ask.id] === undefined)
				.sort((a, b) => a.at - b.at);
			const gone = s.open.filter((ask) => !open.some((o) => o.id === ask.id));
			return [
				{
					open,
					refused: keep(s.refused, (id) => open.some((ask) => ask.id === id)),
					closed: {
						...s.closed,
						...Object.fromEntries(gone.map((ask) => [ask.id, {ask, said: GONE}])),
					},
				},
				[],
			];
		},
		settled: (s, m) => [
			{
				open: s.open.filter((ask) => ask.id !== m.ask.id),
				refused: keep(s.refused, (id) => id !== m.ask.id),
				closed: {...s.closed, [m.ask.id]: {ask: m.ask, said: saidOf(m.answer)}},
			},
			[],
		],
		refused: (s, m) => [
			s.open.some((ask) => ask.id === m.id) ? {...s, refused: {...s.refused, [m.id]: m.why}} : s,
			[],
		],
	},
});

/**
 * Every page of the desk, by where it is shown: one per ask id, then `inbox`.
 * The inbox comes last, so a row never links to a page not yet shown. Pure.
 */
export function pagesOf(s: Desk): ReadonlyMap<string, Page> {
	return new Map<string, Page>([
		...s.open.map((ask): [string, Page] => [ask.id, askPage(ask, s.refused[ask.id] ?? null)]),
		...Object.entries(s.closed).map(([id, {ask, said}]): [string, Page] => [
			id,
			{kind: "closed", ask, said},
		]),
		["inbox", inboxPage(s.open)],
	]);
}

export const deskKind = kind({
	machine: desk,
	parent: "main",
	options: () => ({ctx: undefined}),
	drawing: () => ({name: "desk", steps: {}, tags: (s) => ({waiting: s.open.length})}),
	status: (s) =>
		s.open.length === 0 ? "nothing waits on the owner" : `${s.open.length} waiting on the owner`,
});
