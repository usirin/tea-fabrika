import {
	arbMsg,
	arbRecordMsg,
	propertyInvariant,
	stubCtxThrowingProxy,
	type Step,
} from "@demlik/tea/pbt";
import * as fc from "fast-check";
import {describe, expect, it} from "vitest";
import {asksMenuMachine} from "./frame.ts";

// The laws of the asks menu's selection (asksMenuMachine), on tea's pbt: after every step of any
// list of Msgs, from the real init. The menu starts with nothing selected, and a select puts the
// row it names under the selection and asks for nothing: no answer, no later, no open (ask-desk
// plan, "Properties" row 10: one selection, drawn as it was picked). Each law has a planted mistake
// below that it catches.

type Machine = typeof asksMenuMachine;
type Model = {selected: string | null};
type Msg = {type: "select"; key: string};
type MenuStep = Step<Model, Msg, never>;

const keys = fc.constantFrom("1/a-1", "3/a-1", "1/a-2", "117/a-approve-8");
const lists = fc.array(arbMsg<Msg>({select: arbRecordMsg("select", {key: keys})}), {
	maxLength: 20,
	size: "max",
});
const OPTS = {numRuns: 150, seed: 119120};
const ctx = stubCtxThrowingProxy<undefined>();

interface Law {
	readonly name: string;
	readonly check: (machine: Machine) => void;
}
const every = (name: string, law: (step: MenuStep) => boolean | string): Law => ({
	name,
	check: (machine) => propertyInvariant(machine, ctx, lists, law as never, OPTS),
});

const selectsWhatItNames = every(
	"a select selects the row it names, and asks for nothing",
	(step) =>
		step.next.selected !== step.msg.key
			? `selected ${step.next.selected}, not ${step.msg.key}`
			: step.cmds.length === 0 || "a select sent a command",
);

const LAWS = [selectsWhatItNames];

const plant = (update: Partial<Machine["update"]>): Machine => ({
	...asksMenuMachine,
	update: {...asksMenuMachine.update, ...update},
});
const PLANTS: readonly {readonly law: Law; readonly mistake: string; readonly machine: Machine}[] =
	[
		{
			law: selectsWhatItNames,
			mistake: "a second select keeps the first row",
			machine: plant({select: (s, m) => [{...s, selected: s.selected ?? m.key}, []]}),
		},
	];

describe("the asks menu's laws (asksMenuMachine)", () => {
	it("starts with nothing selected and asks for nothing", () => {
		expect(asksMenuMachine.init(undefined as never, ctx)).toEqual([{selected: null}, []]);
	});

	it.each(LAWS.map((law) => [law.name, law] as const))("%s", (_, law) => {
		law.check(asksMenuMachine);
	});

	it.each(PLANTS.map((p) => [p.mistake, p] as const))(
		"the planted mistake %s is caught",
		(_, {law, machine}) => {
			expect(() => law.check(machine)).toThrow();
		},
	);

	it("every law has a planted mistake", () => {
		expect(LAWS.filter((law) => !PLANTS.some((p) => p.law === law))).toEqual([]);
	});
});
