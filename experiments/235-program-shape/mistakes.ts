// The mistakes the owner named, made on purpose in each shape. `@ts-expect-error` marks a mistake
// tsc stops; tsc fails this file if one of them compiles after all. A mistake with no mark
// compiles, and its comment says when, if ever, it is caught. next/ only.
import {applyCell} from "@demlik/tea";
import {Machine} from "@demlik/tea/effect";
import {Schema} from "effect";
import {Program as Today} from "../../next/packages/libfabrika/src/index.ts";
import {ticketMachine as todayMachine} from "./shape-1-today.ts";
import {Event, Input, Output, Program as Program2} from "./shape-2-lib.ts";
import {Fact as Fact3, Program as Records} from "./shape-3-lib.ts";
import {ticket as threeTicket} from "./shape-3-records.ts";
import {
	Answer,
	Answered,
	Comment,
	Commented,
	Model,
	TicketNumber,
	readTicket,
	start,
} from "./ticket-data.ts";

const base = {
	name: "ticket",
	machine: todayMachine,
	state: {v: 1, upgrades: []},
	view: (m: Model) => ({now: m.now}),
	refuse: () => null,
	outputs: {},
	writes: {},
	wake: () => null,
} as const;

// 1. A typo in an input's name.
// Shape 1: the key must be a Msg type, so tsc stops it.
Today.make({
	...base,
	// @ts-expect-error `coment` is no Msg type
	inputs: {coment: "Comment"},
});
// Shape 2: there is no key to mistype; the update table's keys are checked by tea.
const comment2 = Input.make("comment", {fields: Comment.fields, description: "Comment"});
Machine.make({
	model: Model,
	msg: Input.group([comment2]),
	cmds: [],
	init: (loaded) => [loaded ?? start, []],
	// @ts-expect-error `coment` is no Msg type, and `comment` has no cell
	update: {coment: (m) => [m, []]},
});
// Shape 3: the key IS the name, so a typo compiles and renames the input. A client that sends
// `comment` is refused `bad_msg` at the door. Caught only by a test or a person reading.
const three = Records.over({model: Model});
three.make({
	name: "ticket",
	init: () => ({model: start, cmds: []}),
	inputs: {
		coment: three.input({
			fields: Comment.fields,
			description: "Comment",
			update: (m) => ({model: m, cmds: []}),
		}),
	},
	view: (m) => ({now: m.now}),
});

// 2. A Cmd that is not listed. All three stop it: tea types a step's Cmds from the list.
Machine.make({
	model: Model,
	msg: Input.group([comment2]),
	cmds: [],
	init: (loaded) => [loaded ?? start, []],
	// @ts-expect-error `ticket_read` is not in `cmds`
	update: {comment: (m) => [m, [readTicket({ticket: 1})]]},
});
three.input({
	fields: Comment.fields,
	description: "Comment",
	// @ts-expect-error `ticket_read` is not in `cmds`
	update: (m) => ({model: m, cmds: [readTicket({ticket: 1})]}),
});

// 3. A plain input that writes a person-only fact, so an agent could cause it.
// Shape 1: compiles. A write's fact is any JSON object. The signer refuses it when the Cmd runs
// (`person_only`, session-manager.ts), after the step was accepted and saved.
// Shape 2 (decided): tsc stops it where the step writes. A person-only input's Msg is branded
// `FromPerson`, and a person-only event's write takes only a Msg with that brand.
const onTicket = (event: {readonly ticket: number}) => `ticket/${event.ticket}`;
const answered2 = Event.make(Answered, {stream: onTicket, personOnly: true});
const commented2 = Event.make(Commented, {stream: onTicket});
const answer2 = Input.make("answer", {
	fields: Answer.fields,
	description: "Answer",
	personOnly: true,
});
const plain2 = Input.make("comment", {fields: Comment.fields, description: "Comment"});
const answerMsg = Schema.decodeUnknownSync(answer2.schema)({
	type: "answer",
	parent: "in-1",
	ticket: 1,
	ask: "a",
	pick: "yes",
	note: "",
	saw: {title: "", body: ""},
});
const commentMsg = Schema.decodeUnknownSync(plain2.schema)({
	type: "comment",
	parent: "in-1",
	ticket: 1,
	body: "Skip part 2.",
});
const anAnswer = Answered.make({
	ticket: 1,
	ask: "a",
	pick: "yes",
	note: "",
	saw: {title: "", body: ""},
});
// (i) A plain input's Msg into a person-only event's write.
// @ts-expect-error `comment` is no person-only input, so its Msg lacks `FromPerson`
answered2.write(commentMsg, anAnswer);
answered2.write(answerMsg, anAnswer);
// A plain event takes any input's Msg, a person's too.
commented2.write(commentMsg, Commented.make({ticket: 1, body: "Skip part 2."}));
commented2.write(answerMsg, Commented.make({ticket: 1, body: "Skip part 2."}));
// Nor a hand-made Msg: an object literal has no brand.
// @ts-expect-error a hand-made Msg is no person's
answered2.write({type: "answer", parent: "in-1"}, anAnswer);
// The write checks the event too.
// @ts-expect-error `answered`'s write takes an `answered` event
answered2.write(answerMsg, Commented.make({ticket: 1, body: "Skip part 2."}));
// Inside a machine: the `comment` cell writes `answered`.
Machine.make({
	model: Model,
	msg: Input.group([plain2, answer2]),
	cmds: [answered2.write],
	init: (loaded) => [loaded ?? start, []],
	update: {
		// @ts-expect-error the `comment` cell's Msg is no person's
		comment: (m, msg) => [m, [answered2.write(msg, anAnswer)]],
		answer: (m, msg) => [m, [answered2.write(msg, anAnswer)]],
		answered_ok: (m) => [m, []],
		answered_err: (m) => [m, []],
	},
});
// `personOnly` is written only as `true`. Left out, anyone may send it.
// @ts-expect-error `personOnly: false` is not a way to write it
Input.make("comment", {fields: Comment.fields, description: "Comment", personOnly: false});
// @ts-expect-error the same for an event
Event.make(Commented, {stream: onTicket, personOnly: false});
// Nor through a `boolean` held in a variable, where tsc checks no extra key: the plain case takes
// no `personOnly` at all.
const flag: boolean = Math.random() > 0.5;
const loose = {fields: Comment.fields, description: "Comment", personOnly: flag};
// @ts-expect-error a `boolean` is neither `true` nor left out
Input.make("comment", loose);
// @ts-expect-error the same for an event
Event.make(Commented, {stream: onTicket, personOnly: flag});

// Shape 3: tsc stops it where the plain input writes.
const gated = Records.over({
	model: Model,
	facts: [Fact3.make(Answered, {who: "person"})],
});
gated.input({
	fields: Comment.fields,
	description: "Comment",
	update: (m, msg, write) => ({
		model: m,
		cmds: [
			write(
				"ticket/1",
				// @ts-expect-error a plain input's write takes no person-only fact
				Answered.make({
					ticket: msg.ticket,
					ask: "a",
					pick: "y",
					note: "",
					saw: {title: "", body: ""},
				}),
			),
		],
	}),
});

// Nor can an input be written by hand to skip `input`'s gate.
three.make({
	name: "ticket",
	init: () => ({model: start, cmds: []}),
	inputs: {
		// @ts-expect-error only `input` makes an input
		answer: {
			fields: Answer.fields,
			description: "Answer",
			personOnly: false,
			refuse: () => null,
			update: (m: Model) => ({model: m, cmds: []}),
		},
	},
	view: (m) => ({now: m.now}),
});

// 4. A saved shape whose number does not match its upgrades.
// Shape 1: compiles, and even loads: `v: 2` with no upgrades boots fresh. A model saved at version 1
// fails later, when it is loaded, as `ProgramDown saved_state` (no upgrade from 1).
Today.make({...base, state: {v: 2, upgrades: []}, inputs: {}});
// Shapes 2 and 3: there is no number to write; it is one more than the upgrades.

// 5. An empty part written out. Shapes 2 and 3 take no `[]` where a list may be left out.
const small2 = Input.group([plain2]);
Program2.make({
	name: "ticket",
	machine: Machine.make({
		model: Model,
		msg: small2,
		cmds: [],
		init: (loaded) => [loaded ?? start, []],
		update: {comment: (m) => [m, []]},
	}),
	inputs: small2,
	view: (m) => ({now: m.now}),
	// @ts-expect-error `outputs` names at least one output, or is left out
	outputs: [],
});

// 6. A step that skips the writer and calls a write Cmd with a write of its own. A write Cmd takes
// only a sealed write, and only libfabrika seals one, so tsc stops it.
// @ts-expect-error an event's write takes only a sealed write
answered2.write({stream: "ticket/1", write: {_tag: "own", fact: {_tag: "answered"}}});
// @ts-expect-error the same in shape 3
Fact3.write({stream: "ticket/1", write: {_tag: "own", fact: {_tag: "answered"}}});

// 7. Shape 3's lists: left out when empty, never written empty.
// @ts-expect-error `facts` holds at least one fact, or is left out
Records.over({model: Model, facts: []});

// 8. A parent steps shape 3's built machine with tea's own `applyCell`, as it would any machine.
const [stepped] = applyCell(threeTicket.machine, start, {
	type: "show",
	ticket: 7,
	parent: "in-process_0123456789abcdefghjkmnpqrs-1",
});
export {stepped};

// 9. A step that takes a write a plain event's write made, puts a person-only event into it, and
// hands it to the person-only event's write through tea's one-argument call. This compiles: a
// TypeScript brand is a type on the object, and a spread keeps it. The brand stops a mistake, not
// a forger. The Cmd is made as written, and the signer refuses it when it runs (`person_only`).
const allowed = commented2.write(commentMsg, Commented.make({ticket: 1, body: "Skip part 2."}));
answered2.write({stream: allowed.stream, write: {...allowed.write, fact: anAnswer}});

// 10. An output whose selector sends what its schema does not say. `null` means nothing to send.
Output.make("ticket", {
	schema: TicketNumber,
	description: "The ticket it shows.",
	// @ts-expect-error a string is no ticket number
	select: (m: Model) => String(m.now),
});
three.make({
	name: "ticket",
	init: () => ({model: start, cmds: []}),
	view: (m) => ({now: m.now}),
	outputs: {
		ticket: {
			schema: TicketNumber,
			description: "The ticket it shows.",
			// @ts-expect-error a string is no ticket number
			select: (m) => String(m.now),
		},
	},
});

// 11. Shape 3: a program that takes no input leaves `inputs` out.
three.make({name: "clock", init: () => ({model: start, cmds: []}), view: (m) => ({now: m.now})});

// 12. (ii) A typo in an update key. tea checks the keys against the Msgs, its event answers too.
Machine.make({
	model: Model,
	msg: Input.group([answer2]),
	cmds: [answered2.write],
	init: (loaded) => [loaded ?? start, []],
	update: {
		answer: (m, msg) => [m, [answered2.write(msg, anAnswer)]],
		// @ts-expect-error `answerd_ok` is no Msg type
		answerd_ok: (m) => [m, []],
		answered_err: (m) => [m, []],
	},
});

// 13. (iii) An event write the machine does not list in `cmds`. tea types a step's Cmds from the
// list, so tsc stops it, as it does any Cmd not listed (2).
Machine.make({
	model: Model,
	msg: Input.group([answer2]),
	cmds: [commented2.write],
	init: (loaded) => [loaded ?? start, []],
	update: {
		// @ts-expect-error `answered` is not in `cmds`
		answer: (m, msg) => [m, [answered2.write(msg, anAnswer)]],
		commented_ok: (m) => [m, []],
		commented_err: (m) => [m, []],
	},
});
