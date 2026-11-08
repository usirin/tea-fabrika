// The mistakes the owner named, made on purpose in each shape. `@ts-expect-error` marks a mistake
// tsc stops; tsc fails this file if one of them compiles after all. A mistake with no mark
// compiles, and its comment says when, if ever, it is caught. next/ only.
import {Machine} from "@demlik/tea/effect";
import {Schema} from "effect";
import {Program as Today} from "../../next/packages/libfabrika/src/index.ts";
import {ticketMachine as todayMachine} from "./shape-1-today.ts";
import {Fact as Fact2, Input} from "./shape-2-lib.ts";
import {Fact as Fact3, Program as Records} from "./shape-3-lib.ts";
import {Answer, Answered, Comment, Model, readTicket, start} from "./ticket-data.ts";

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
const three = Records.over({model: Model, facts: [], cmds: []});
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
	answers: {write: {ok: (m) => ({model: m, cmds: []}), err: (m) => ({model: m, cmds: []})}},
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
// Shape 2: tsc stops it twice, where the input is made and where it writes.
const answered2 = Fact2.make(Answered, {who: "person"});
// @ts-expect-error a plain input may not cause a person-only fact
Input.make("comment", {fields: Comment.fields, description: "Comment", causes: [answered2]});
const answer2 = Input.make("answer", {
	fields: Answer.fields,
	description: "Answer",
	who: "person",
	causes: [answered2],
});
const commented2 = Fact2.make(Schema.TaggedStruct("commented", Comment.fields));
const comment2b = Input.make("comment", {
	fields: Comment.fields,
	description: "Comment",
	causes: [commented2],
});
comment2b.write(
	{type: "comment", parent: "in-1"},
	"ticket/1",
	// @ts-expect-error `comment` causes only `commented`
	Answered.make({ticket: 1, ask: "a", pick: "yes", note: "", saw: {title: "", body: ""}}),
);
answer2.write(
	{type: "answer", parent: "in-1"},
	"ticket/1",
	Answered.make({ticket: 1, ask: "a", pick: "yes", note: "", saw: {title: "", body: ""}}),
);
// Nor can a plain input's step borrow a person-only input's writer: it takes only its own Msg.
answer2.write(
	// @ts-expect-error a `comment` Msg cannot cause an `answer` write
	{type: "comment", parent: "in-1"},
	"ticket/1",
	Answered.make({ticket: 1, ask: "a", pick: "yes", note: "", saw: {title: "", body: ""}}),
);
// Shape 3: tsc stops it where the plain input writes.
const gated = Records.over({
	model: Model,
	facts: [Fact3.make(Answered, {who: "person"})],
	cmds: [],
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
	answers: {write: {ok: (m) => ({model: m, cmds: []}), err: (m) => ({model: m, cmds: []})}},
	view: (m) => ({now: m.now}),
});

// 4. A saved shape whose number does not match its upgrades.
// Shape 1: compiles. The load fails as `ProgramDown load` (a gap: v 2 with no upgrade from 1).
Today.make({...base, state: {v: 2, upgrades: []}, inputs: {}});
// Shapes 2 and 3: there is no number to write; it is one more than the upgrades.

// 5. An empty part written out. Shapes 2 and 3 take no `[]` where a list may be left out.
// @ts-expect-error `causes` names at least one fact, or is left out
Input.make("close", {fields: Comment.fields, description: "Close", causes: []});
