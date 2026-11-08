// Shape 2: inputs, facts and outputs are values; the machine's Msg is built from the inputs.
// next/ only. The known way is Elm's ports and Effect's `Rpc.make`: one typed value per message,
// passed by reference, so no key has to match another. The machine is tea's own Machine.make.
import {Machine} from "@demlik/tea/effect";
import {Fact, Input, Output, Program} from "./shape-2-lib.ts";
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

// The facts it writes. Only `answered` is a person's alone.
const commented = Fact.make(Commented);
const answered = Fact.make(Answered, {who: "person"});
const closed = Fact.make(Closed);
const reopened = Fact.make(Reopened);

// The inputs: each one's name, fields, words, who may send it and the facts it may cause, in one
// place. `causes: [answered]` on an input without `who: "person"` does not compile.
const show = Input.make("show", {
	fields: Show.fields,
	description: "Show a ticket now, by its number: what a pipe from the tracker sends.",
});
const comment = Input.make("comment", {
	fields: Comment.fields,
	description: 'Comment on the ticket shown. `asks: "changes"` requests changes.',
	causes: [commented],
});
const answer = Input.make("answer", {
	fields: Answer.fields,
	description: "Answer an open ask on the ticket shown. A person only.",
	who: "person",
	causes: [answered],
});
const close = Input.make("close", {
	fields: OneTicket.fields,
	description: "Close the ticket shown.",
	causes: [closed],
});
const reopen = Input.make("reopen", {
	fields: OneTicket.fields,
	description: "Reopen the ticket shown.",
	causes: [reopened],
});

// The output: what it sends, picked from the model, each time that value changes.
const shown = Output.make("ticket", {
	schema: TicketNumber,
	description: "The ticket it shows: sent each time that changes, so the next program follows.",
	select: (m: Model) => m.now,
});

// The Msg is the inputs. A Msg no client can send cannot be written.
const inputs = Input.group([show, comment, answer, close, reopen]);

export const ticketMachine = Machine.make({
	model: Model,
	msg: inputs,
	cmds: [readTicket, Fact.write],
	init: (loaded) => [loaded ?? start, []],
	update: {
		show: (m, msg) => {
			if (m.now === msg.ticket) return [m, []];
			const seen = m.shown.includes(msg.ticket) ? m.shown : [...m.shown, msg.ticket];
			return [{...m, now: msg.ticket, shown: seen, page: null}, [readTicket({ticket: msg.ticket})]];
		},
		comment: (m, msg) => [
			{...m, saving: m.saving + 1},
			[
				comment.write(
					msg,
					stream(msg.ticket),
					Commented.make({ticket: msg.ticket, body: msg.body, ...pick(msg)}),
				),
			],
		],
		answer: (m, msg) => [
			{...m, saving: m.saving + 1},
			[
				answer.write(
					msg,
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
		],
		close: (m, msg) => [
			{...m, saving: m.saving + 1},
			[close.write(msg, stream(msg.ticket), Closed.make({ticket: msg.ticket}))],
		],
		reopen: (m, msg) => [
			{...m, saving: m.saving + 1},
			[reopen.write(msg, stream(msg.ticket), Reopened.make({ticket: msg.ticket}))],
		],
		// tea's own names for a Cmd's answers, checked by tsc against `cmds` above.
		ticket_read_ok: (m, msg) => [m.now === msg.value.number ? {...m, page: msg.value} : m, []],
		ticket_read_err: (m, msg) => [{...m, failed: msg.error._tag}, []],
		write_ok: (m) => [{...m, saving: m.saving - 1}, []],
		write_err: (m, msg) => [{...m, saving: m.saving - 1, failed: msg.error._tag}, []],
	},
});

/** `asks` only when the comment asked for changes, so the fact never holds an empty key. */
const pick = (msg: {readonly asks?: "changes"}) => (msg.asks === undefined ? {} : {asks: msg.asks});

// The program: the machine, plus what only a program has. Nothing empty is written.
export const ticket = Program.make({
	name: "ticket",
	machine: ticketMachine,
	inputs,
	view: (m) => ({now: m.now, page: m.page, saving: m.saving, failed: m.failed}),
	refuse: (m, msg) =>
		msg.type !== "show" && !m.shown.includes(msg.ticket) ? {why: "not_shown"} : null,
	outputs: [shown],
});
