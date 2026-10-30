import {
	arbMsg,
	arbMsgSequence,
	arbRecordMsg,
	type MsgArbitraryTable,
	propertyInvariant,
	propertyTrace,
	stubCtxThrowingProxy,
} from "@demlik/tea/pbt";
import type {MsgOf} from "@kampus/fabrika";
import * as fc from "fast-check";
import {describe, expect, it} from "vitest";
import {markdown} from "./index.ts";
import {Root} from "./root.ts";

// The markdown page's laws, on tea's pbt: after every step of any list of texts told, from the
// real init. Its one machine, `page`, is reached through the program, as a host reaches it.

const page = markdown.machines.page.machine;
type Page = typeof page;
type Msg = MsgOf<Page>;

/** Texts this repo writes, and any text at all. */
const text = fc.oneof(
	fc.constantFrom("# Hi", "- a\n- b", "| a |\n|---|\n| 1 |", "```\ncode\n```", "> q", "---", ""),
	fc.string({maxLength: 80}),
);
/** One entry per Msg type: leaving one out does not compile. */
const table: MsgArbitraryTable<Msg> = {show: arbRecordMsg("show", {text})};
const lists = arbMsgSequence(arbMsg(table), {maxLength: 20});
const OPTS = {numRuns: 300, seed: 1};
const ctx = stubCtxThrowingProxy<undefined>();

interface Law {
	readonly name: string;
	/** Throws when `machine` breaks the law, with the shortest list that does. */
	readonly check: (machine: Page) => void;
}

const showsWhatItIsTold: Law = {
	name: "each text told replaces the page with that text read, and asks for no work",
	check: (machine) =>
		propertyInvariant(
			machine,
			ctx,
			lists,
			({msg, next, cmds}) =>
				JSON.stringify(next.root) === JSON.stringify(Root.fromMarkdown(msg.text)) &&
				cmds.length === 0,
			OPTS,
		),
};

const startsEmpty: Law = {
	name: "from the start, the page is the last text told, or nothing",
	check: (machine) =>
		propertyTrace(
			machine,
			ctx,
			lists,
			(steps, last) =>
				JSON.stringify(last.root) ===
				JSON.stringify(Root.fromMarkdown(steps.at(-1)?.msg.text ?? "")),
			OPTS,
		),
};

const LAWS = [showsWhatItIsTold, startsEmpty];

/** The names of the laws `machine` breaks. */
const broken = (machine: Page): readonly string[] =>
	LAWS.filter((law) => {
		try {
			law.check(machine);
			return false;
		} catch {
			return true;
		}
	}).map((law) => law.name);

// Planted mistakes: the real machine with one part changed.
const keepsTheFirst: Page = {
	...page,
	update: {
		show: (s, m) => [s.root.children.length > 0 ? s : {root: Root.fromMarkdown(m.text)}, []],
	},
};
const startsWithAHeading: Page = {...page, init: () => [{root: Root.fromMarkdown("# Page")}, []]};

describe("the markdown page's laws", () => {
	it.each(LAWS.map((law) => [law.name, law] as const))("%s", (_, law) => {
		law.check(page);
	});

	it("each law is seen to fail on a planted mistake", () => {
		expect(broken(keepsTheFirst)).toEqual([showsWhatItIsTold.name, startsEmpty.name]);
		expect(broken(startsWithAHeading)).toEqual([startsEmpty.name]);
	});
});
