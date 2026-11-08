// The counter, next/: the first real program (Tier 1, P11). A pure tea machine and its
// declarations, nothing else: no window until P14.
import {Machine} from "@demlik/tea/effect";
import {Input} from "@kampus/libfabrika";
import {Schema} from "effect";

const Model = Schema.Struct({count: Schema.Int});
type Model = typeof Model.Type;
const Msg = Schema.Union([
	Schema.Struct({type: Schema.Literal("inc")}),
	Schema.Struct({type: Schema.Literal("dec")}),
	Schema.Struct({type: Schema.Literal("reset")}),
]);

const machine = Machine.make({
	model: Model,
	msg: Msg,
	cmds: [],
	init: (loaded) => [loaded ?? {count: 0}, []],
	update: {
		inc: (s) => [{count: s.count + 1}, []],
		dec: (s) => [{count: s.count - 1}, []],
		reset: () => [{count: 0}, []],
	},
});

const port = (description: string) =>
	Input.cases.write.make({schema: Msg, description, personOnly: false});

export const counter = {
	name: "counter",
	machine,
	state: {v: 1, schema: Model, upgrades: []},
	msg: Msg,
	view: {data: Model, select: (model: Model): Model => model},
	/** The counter refuses nothing. */
	refuse: (_model: Model, _msg: {readonly type: string}): null => null,
	inputs: {
		inc: port("Add one"),
		dec: port("Take one away"),
		reset: port("Back to zero"),
	},
	outputs: {},
	writes: {},
	wake: (_model: Model): null => null,
};
