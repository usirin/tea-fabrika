import {
	arbConstantMsg,
	arbMsg,
	arbRecordMsg,
	type MsgArbitraryTable,
	propertyTrace,
	stubCtxThrowingProxy,
} from "@demlik/tea/pbt";
import type {MsgOf} from "@kampus/fabrika-old";
import type {Entry} from "@kampus/pipeline/tickets/ticket";
import {oneOf, tickets} from "@tea-fabrika/tracker";
import {OWNER, SEVEN} from "@tea-fabrika/tracker/seven";
import * as fc from "fast-check";
import {expect, it} from "vitest";

// Today's version: the existing tracker reducer, exported as tickets for map.
// Start at its real init. All facts, identities and times here are made up.
// Replies are typed by the real machine's Msg union; no private package imports
// or replacement reducer are needed to generate them.

type Machine = typeof tickets;
type Msg = MsgOf<Machine>;
type Reply<T extends Msg["type"]> = Extract<Msg, {readonly type: T}>;

const ENTRIES: readonly Entry[] = [
	...SEVEN,
	{
		pos: 8,
		ticket: 3,
		by: OWNER,
		at: 8,
		fact: {type: "filed", title: "Made-up documentation correction", body: ""},
	},
	{
		pos: 9,
		ticket: 9,
		by: OWNER,
		at: 9,
		fact: {type: "filed", title: "Made-up running ticket", body: ""},
	},
];

const read = (entries: readonly Entry[], after = 0): Reply<"load_ok"> => ({
	type: "load_ok",
	cmd: {type: "load", after},
	value: {entries, broken: [], last: entries.at(-1)?.pos ?? after},
	at: 0,
});

const numbers = fc.constantFrom(7, 3, 9);
const save = {
	type: "save",
	id: "made-up-write",
	write: {kind: "close", ticket: 7},
	next: 10,
} as const;
const duplicates = {
	type: "duplicates",
	ticket: 7,
	filed: {title: "Made-up filing", body: ""},
	candidates: [],
} as const;
const hints = {type: "save_hints", ticket: 7, hints: []} as const;

/** One generator per Msg type, including every command reply. */
const table: MsgArbitraryTable<Msg> = {
	list: arbConstantMsg("list"),
	open: arbRecordMsg("open", {ticket: numbers}),
	write: arbRecordMsg("write", {
		id: fc.constant(save.id),
		write: fc.constant(save.write),
	}),
	quit: arbConstantMsg("quit"),
	moved: arbConstantMsg("moved"),
	show: arbRecordMsg("show", {show: fc.constantFrom("open", "closed", "all")}),
	find: arbRecordMsg("find", {text: fc.constantFrom("", "Made-up", "absent")}),
	refresh: arbConstantMsg("refresh"),
	tick: arbRecordMsg("tick", {now: fc.nat({max: 1_000_000})}),
	pull_requests_ok: fc.constant<Reply<"pull_requests_ok">>({
		type: "pull_requests_ok",
		cmd: {type: "pull_requests"},
		value: {pullRequests: []},
		at: 0,
	}),
	pull_requests_err: fc.constant<Reply<"pull_requests_err">>({
		type: "pull_requests_err",
		cmd: {type: "pull_requests"},
		error: {_tag: "unreachable"},
		at: 0,
	}),
	load_ok: fc
		.tuple(fc.constantFrom<readonly Entry[]>([], ENTRIES.slice(0, 4), ENTRIES), fc.nat({max: 20}))
		.map(([entries, after]) => read(entries, after)),
	load_err: fc.nat({max: 20}).map((after): Reply<"load_err"> => ({
		type: "load_err",
		cmd: {type: "load", after},
		error: {_tag: "unreachable"},
		at: 0,
	})),
	save_ok: numbers.map((ticket): Reply<"save_ok"> => ({
		type: "save_ok",
		cmd: save,
		value: {ticket},
		at: 0,
	})),
	save_err: fc.constant<Reply<"save_err">>({
		type: "save_err",
		cmd: save,
		error: {_tag: "refused"},
		at: 0,
	}),
	duplicates_ok: fc.constant<Reply<"duplicates_ok">>({
		type: "duplicates_ok",
		cmd: duplicates,
		value: {kind: "off"},
		at: 0,
	}),
	duplicates_err: fc.constant<Reply<"duplicates_err">>({
		type: "duplicates_err",
		cmd: duplicates,
		error: {_tag: "unreachable"},
		at: 0,
	}),
	save_hints_ok: fc.constant<Reply<"save_hints_ok">>({
		type: "save_hints_ok",
		cmd: hints,
		value: {},
		at: 0,
	}),
	save_hints_err: fc.constant<Reply<"save_hints_err">>({
		type: "save_hints_err",
		cmd: hints,
		error: {_tag: "unreachable"},
		at: 0,
	}),
};

// Every trace exercises two different selections and repeats before loading,
// then selections and a late empty reply after loading. Arbitrary messages follow.
// The prefix survives shrinking, so an ignored selection cannot pass vacuously.
const pairs = fc.constantFrom([7, 3] as const, [3, 9] as const, [9, 7] as const);
const sequences = fc
	.tuple(pairs, fc.array(arbMsg(table), {maxLength: 40}))
	.map(([[first, second], rest]): readonly Msg[] => [
		{type: "open", ticket: first},
		{type: "open", ticket: first},
		{type: "open", ticket: second},
		read(ENTRIES),
		{type: "open", ticket: second},
		{type: "open", ticket: first},
		read([], 9),
		{type: "open", ticket: first},
		...rest,
	]);

const latestSelection = (machine: Machine) =>
	propertyTrace(
		machine,
		stubCtxThrowingProxy<undefined>(),
		sequences,
		(steps) => {
			let selected: number | null = null;
			const filed = new Set<number>();
			for (const {msg, next} of steps) {
				if (msg.type === "open") selected = msg.ticket;
				if (msg.type === "list") selected = null;
				if (msg.type === "load_ok")
					for (const entry of msg.value.entries)
						if (entry.fact.type === "filed") filed.add(entry.ticket);
				const view = oneOf(next);
				if (view.number !== selected)
					return `latest selection: expected ${selected}, saw ${view.number} after ${msg.type}`;
				if (selected === null && view.ticket !== null)
					return "latest selection: a cleared selection still shows a ticket";
				if (selected !== null && filed.has(selected) && view.ticket?.number !== selected)
					return `latest selection: the loaded ticket does not identify ${selected}`;
			}
			return true;
		},
		{seed: 119120, numRuns: 150},
	);

it("p10: the ticket view keeps the latest selection across generated ledger replies", () => {
	latestSelection(tickets);
});

it("plant: ignoring open breaks the latest-selection law", () => {
	const ignored: Machine = {
		...tickets,
		update: {...tickets.update, open: (state) => [state, []]},
	};
	expect(() => latestSelection(ignored)).toThrow(/latest selection/);
});
