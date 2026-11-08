// Shape 1: the ticket program on today's Program.make, as merged in PR 522. next/ only.
// Written whole and honestly: every field the merged code makes you write, and each place where
// one part points at another only because two strings match. Those places are marked LINK.
import {Cmd, Machine} from "@demlik/tea/effect";
import {Schema} from "effect";
import {Program, Write} from "../../next/packages/libfabrika/src/index.ts";
import {
	Answer,
	Answered,
	Closed,
	Comment,
	Commented,
	Model,
	OneTicket,
	Reopened,
	Show,
	TicketNumber,
	readTicket,
	start,
	stream,
} from "./ticket-data.ts";

/** The door's stamp. A Msg that causes a write must carry it, so each such Msg spells it out. */
const parent = Write.cases.caused.fields.parent;

// LINK: each `type` here must equal a key of `inputs` below, or the door never lets it in.
const Msg = Schema.Union([
	Schema.Struct({type: Schema.Literal("show"), ...Show.fields}),
	Schema.Struct({type: Schema.Literal("comment"), parent, ...Comment.fields}),
	Schema.Struct({type: Schema.Literal("answer"), parent, ...Answer.fields}),
	Schema.Struct({type: Schema.Literal("close"), parent, ...OneTicket.fields}),
	Schema.Struct({type: Schema.Literal("reopen"), parent, ...OneTicket.fields}),
]);

// LINK: the runner performs a Cmd only when its name is exactly "write", its input has `stream`
// and `write`, and its error tags are the runner's. Every program writes this Cmd again by hand.
const write = Cmd.make("write", {
	input: Schema.Struct({stream: Schema.String, write: Write}),
	ok: Schema.Json,
	err: ["not_delivered", "spent", "person_only", "ended", "not_granted", "bad_cmd", "forbidden"],
});

/** A write caused by the input `m`, on its ticket's stream. Any fact fits: `fact` is any JSON object. */
const caused = (
	m: {readonly parent: string; readonly ticket: number},
	fact: typeof Write.cases.caused.fields.fact.Type,
) => write({stream: stream(m.ticket), write: Write.cases.caused.make({parent: m.parent, fact})});

export const ticketMachine = Machine.make({
	model: Model,
	msg: Msg,
	cmds: [readTicket, write],
	init: (loaded) => [loaded ?? start, []],
	update: {
		show: (m, msg) => {
			if (m.now === msg.ticket) return [m, []];
			const shown = m.shown.includes(msg.ticket) ? m.shown : [...m.shown, msg.ticket];
			// The output `ticket` should be sent here. As merged, nothing can send an output: see
			// `outputs` below.
			return [{...m, now: msg.ticket, shown, page: null}, [readTicket({ticket: msg.ticket})]];
		},
		comment: (m, msg) => [
			{...m, saving: m.saving + 1},
			[caused(msg, Commented.make({ticket: msg.ticket, body: msg.body, ...pick(msg)}))],
		],
		answer: (m, msg) => [
			{...m, saving: m.saving + 1},
			[
				caused(
					msg,
					Answered.make({
						ticket: msg.ticket,
						ask: msg.ask,
						pick: msg.pick,
						note: msg.note,
						saw: msg.saw,
					}),
				),
			],
		],
		close: (m, msg) => [
			{...m, saving: m.saving + 1},
			[caused(msg, Closed.make({ticket: msg.ticket}))],
		],
		reopen: (m, msg) => [
			{...m, saving: m.saving + 1},
			[caused(msg, Reopened.make({ticket: msg.ticket}))],
		],
		// LINK: `<cmd>_ok` and `<cmd>_err` are names tea makes from each Cmd's name.
		ticket_read_ok: (m, msg) => [m.now === msg.value.number ? {...m, page: msg.value} : m, []],
		ticket_read_err: (m, msg) => [{...m, failed: msg.error._tag}, []],
		write_ok: (m) => [{...m, saving: m.saving - 1}, []],
		write_err: (m, msg) => [{...m, saving: m.saving - 1, failed: msg.error._tag}, []],
	},
});

/** `asks` only when the comment asked for changes, so the fact never holds an empty key. */
const pick = (msg: {readonly asks?: "changes"}) => (msg.asks === undefined ? {} : {asks: msg.asks});

export const ticket = Program.make({
	name: "ticket",
	machine: ticketMachine,
	// Written for every program, even one that never changed its saved shape.
	state: {v: 1, upgrades: []},
	view: (m) => ({now: m.now, page: m.page, saving: m.saving, failed: m.failed}),
	// One function for every Msg. It runs on fresh inputs only, before update.
	refuse: (m, msg) =>
		msg.type !== "show" && !m.shown.includes(msg.ticket) ? {why: "not_shown"} : null,
	// LINK: each key must equal a Msg `type` above. A string is a plain input; an object is a
	// person-only one. Two ways to write one thing.
	inputs: {
		show: "Show a ticket now, by its number: what a pipe from the tracker sends.",
		comment: 'Comment on the ticket shown. `asks: "changes"` requests changes.',
		answer: {
			description: "Answer an open ask on the ticket shown. A person only.",
			personOnly: true,
		},
		close: "Close the ticket shown.",
		reopen: "Reopen the ticket shown.",
	},
	// Declared, and nothing sends it: the merged runner has no way to send an output yet, and no
	// decided note says how one will be sent.
	outputs: {ticket: TicketNumber},
	// LINK: each key must equal its fact's `_tag` (the types check that much). Nothing here says
	// which input may cause which fact: `personOnly` on `answer` and on `answered` are two flags,
	// kept in step by hand. When the write runs, the signer refuses a person-only fact unless the
	// input that caused it was person-only and a person sent it, after the step was saved.
	writes: {
		commented: {schema: Commented, personOnly: false},
		answered: {schema: Answered, personOnly: true},
		closed: {schema: Closed, personOnly: false},
		reopened: {schema: Reopened, personOnly: false},
	},
	// Written for every program, even one that never wakes.
	wake: () => null,
});
