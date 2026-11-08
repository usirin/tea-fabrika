// Shape 2, as decided on 2026-11-08: inputs, events and outputs are values; the machine's Msg is
// built from the inputs, and each event's write is a Cmd the machine lists. next/ only. The known
// way is Elm's ports and Effect's `Rpc.make`: one typed value per message, passed by reference,
// so no key has to match another. The machine is tea's own Machine.make.
import {Machine} from "@demlik/tea/effect";
import {Event, Input, Output, Program} from "./shape-2-lib.ts";
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

// The events it writes, each to its ticket's stream. Only `answered` is a person's alone.
const onTicket = (event: {readonly ticket: number}) => stream(event.ticket);
const commented = Event.make(Commented, {stream: onTicket});
const answered = Event.make(Answered, {stream: onTicket, personOnly: true});
const closed = Event.make(Closed, {stream: onTicket});
const reopened = Event.make(Reopened, {stream: onTicket});

// The inputs: plain data, each with its name, fields and words. Only `answer` is a person's alone.
const show = Input.make("show", {
	fields: Show.fields,
	description: "Show a ticket now, by its number: what a pipe from the tracker sends.",
});
const comment = Input.make("comment", {
	fields: Comment.fields,
	description: 'Comment on the ticket shown. `asks: "changes"` requests changes.',
});
const answer = Input.make("answer", {
	fields: Answer.fields,
	description: "Answer an open ask on the ticket shown. A person only.",
	personOnly: true,
});
const close = Input.make("close", {
	fields: OneTicket.fields,
	description: "Close the ticket shown.",
});
const reopen = Input.make("reopen", {
	fields: OneTicket.fields,
	description: "Reopen the ticket shown.",
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
	cmds: [readTicket, commented.write, answered.write, closed.write, reopened.write],
	init: (loaded) => [loaded ?? start, []],
	update: {
		show: (m, msg) => {
			if (m.now === msg.ticket) return [m, []];
			const seen = m.shown.includes(msg.ticket) ? m.shown : [...m.shown, msg.ticket];
			return [{...m, now: msg.ticket, shown: seen, page: null}, [readTicket({ticket: msg.ticket})]];
		},
		comment: (m, msg) => [
			{...m, saving: m.saving + 1},
			[commented.write(msg, Commented.make({ticket: msg.ticket, body: msg.body, ...pick(msg)}))],
		],
		// tsc lets only a person-only input's Msg into a person-only event's write.
		answer: (m, msg) => [
			{...m, saving: m.saving + 1},
			[
				answered.write(
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
			[closed.write(msg, Closed.make({ticket: msg.ticket}))],
		],
		reopen: (m, msg) => [
			{...m, saving: m.saving + 1},
			[reopened.write(msg, Reopened.make({ticket: msg.ticket}))],
		],
		// tea's own names for a Cmd's answers, checked by tsc against `cmds` above: two per event
		// write, accepted for now as a tea problem (decided 2026-11-08).
		ticket_read_ok: (m, msg) => [m.now === msg.value.number ? {...m, page: msg.value} : m, []],
		ticket_read_err: (m, msg) => [{...m, failed: msg.error._tag}, []],
		commented_ok: saved,
		commented_err: (m, msg) => failed(m, msg.error._tag),
		answered_ok: saved,
		answered_err: (m, msg) => failed(m, msg.error._tag),
		closed_ok: saved,
		closed_err: (m, msg) => failed(m, msg.error._tag),
		reopened_ok: saved,
		reopened_err: (m, msg) => failed(m, msg.error._tag),
	},
});

/** A write landed: one fewer in flight. */
function saved(m: Model): readonly [Model, readonly []] {
	return [{...m, saving: m.saving - 1}, []];
}
/** A write was refused: one fewer in flight, and why. */
function failed(m: Model, why: string): readonly [Model, readonly []] {
	return [{...m, saving: m.saving - 1, failed: why}, []];
}

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
