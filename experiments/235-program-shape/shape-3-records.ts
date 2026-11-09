// Shape 3: one record per input, holding its fields, words, gate, refusal and step, and one per
// Cmd, holding its two answers. Program.make builds the tea machine from them. next/ only.
// The known way is Redux Toolkit's `createSlice` and XState v5's `setup`.
import {Fact, Program} from "./shape-3-lib.ts";
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

// First the model, the facts it writes and the Cmds it runs, so each step below is checked
// against them. Only `answered` is a person's alone.
const {input, make} = Program.over({
	model: Model,
	facts: [
		Fact.make(Commented),
		Fact.make(Answered, {who: "person"}),
		Fact.make(Closed),
		Fact.make(Reopened),
	],
	cmds: [readTicket],
});

/** A write is taken only for a ticket this process has shown. */
const notShown = (m: Model, msg: {readonly ticket: number}) =>
	m.shown.includes(msg.ticket) ? null : {why: "not_shown"};

/** `asks` only when the comment asked for changes, so the fact never holds an empty key. */
const pick = (msg: {readonly asks?: "changes"}) => (msg.asks === undefined ? {} : {asks: msg.asks});

export const ticket = make({
	name: "ticket",
	init: (saved) => ({model: saved ?? start, cmds: []}),
	// Each key is the input's name and its Msg's `type`, written once.
	inputs: {
		show: input({
			fields: Show.fields,
			description: "Show a ticket now, by its number: what a pipe from the tracker sends.",
			update: (m, msg) =>
				m.now === msg.ticket
					? {model: m, cmds: []}
					: {
							model: {
								...m,
								now: msg.ticket,
								shown: m.shown.includes(msg.ticket) ? m.shown : [...m.shown, msg.ticket],
								page: null,
							},
							cmds: [readTicket({ticket: msg.ticket})],
						},
		}),
		comment: input({
			fields: Comment.fields,
			description: 'Comment on the ticket shown. `asks: "changes"` requests changes.',
			refuse: notShown,
			update: (m, msg, write) => ({
				model: {...m, saving: m.saving + 1},
				cmds: [
					write(
						stream(msg.ticket),
						Commented.make({ticket: msg.ticket, body: msg.body, ...pick(msg)}),
					),
				],
			}),
		}),
		answer: input({
			fields: Answer.fields,
			description: "Answer an open ask on the ticket shown. A person only.",
			who: "person",
			refuse: notShown,
			update: (m, msg, write) => ({
				model: {...m, saving: m.saving + 1},
				cmds: [
					write(
						stream(msg.ticket),
						Answered.make({
							ticket: msg.ticket,
							ask: msg.ask,
							pick: msg.pick,
							note: msg.note,
							saw: msg.saw,
						}),
					),
				],
			}),
		}),
		close: input({
			fields: OneTicket.fields,
			description: "Close the ticket shown.",
			refuse: notShown,
			update: (m, msg, write) => ({
				model: {...m, saving: m.saving + 1},
				cmds: [write(stream(msg.ticket), Closed.make({ticket: msg.ticket}))],
			}),
		}),
		reopen: input({
			fields: OneTicket.fields,
			description: "Reopen the ticket shown.",
			refuse: notShown,
			update: (m, msg, write) => ({
				model: {...m, saving: m.saving + 1},
				cmds: [write(stream(msg.ticket), Reopened.make({ticket: msg.ticket}))],
			}),
		}),
	},
	// Each Cmd's two answers, beside each other. A Cmd left out of `cmds` above has no key here.
	answers: {
		ticket_read: {
			ok: (m, page) => ({model: m.now === page.number ? {...m, page} : m, cmds: []}),
			err: (m, error) => ({model: {...m, failed: error._tag}, cmds: []}),
		},
		write: {
			ok: (m) => ({model: {...m, saving: m.saving - 1}, cmds: []}),
			err: (m, error) => ({model: {...m, saving: m.saving - 1, failed: error._tag}, cmds: []}),
		},
	},
	view: (m) => ({now: m.now, page: m.page, saving: m.saving, failed: m.failed}),
	outputs: {
		ticket: {
			schema: TicketNumber,
			description: "The ticket it shows: sent each time that changes, so the next program follows.",
			select: (m) => m.now,
		},
	},
});

/** The machine it built: a parent holds it and steps it, and laws fold it. */
const _ticketMachine = ticket.machine;
