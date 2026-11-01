import {
	arbMsg,
	arbMsgSequence,
	arbRecordMsg,
	type MsgArbitraryTable,
	propertyInvariant,
	propertyTrace,
	stubCtxThrowingProxy,
} from "@demlik/tea/pbt";
import type {MsgOf} from "@kampus/fabrika-old";
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
const table: MsgArbitraryTable<Msg> = {
	show: arbRecordMsg("show", {text}),
	told: arbRecordMsg("told", {text}),
	cooled: fc.constant({type: "cooled" as const}),
};
const lists = arbMsgSequence(arbMsg(table), {maxLength: 20});
const OPTS = {numRuns: 300, seed: 1};
const ctx = stubCtxThrowingProxy<undefined>();

interface Law {
	readonly name: string;
	/** Throws when `machine` breaks the law, with the shortest list that does. */
	readonly check: (machine: Page) => void;
}

const same = (root: unknown, text: string) =>
	JSON.stringify(root) === JSON.stringify(Root.fromMarkdown(text));

const showsWhatItIsTold: Law = {
	name: "a text shown replaces the page, a text told does or waits, and neither asks for work",
	check: (machine) =>
		propertyInvariant(
			machine,
			ctx,
			lists,
			({msg, next, cmds}) =>
				cmds.length === 0 &&
				(msg.type === "cooled" ||
					(msg.type === "told" && next.waiting === msg.text) ||
					same(next.root, msg.text)),
			OPTS,
		),
};

const startsEmpty: Law = {
	name: "from the start, the newest text is on the page or waiting, and nothing while none came",
	check: (machine) =>
		propertyTrace(
			machine,
			ctx,
			lists,
			(steps, last) => {
				const newest = steps.flatMap((s) => (s.msg.type === "cooled" ? [] : [s.msg.text])).at(-1);
				return last.waiting !== null ? last.waiting === newest : same(last.root, newest ?? "");
			},
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
		...page.update,
		show: (s, m) => [s.root.children.length > 0 ? s : {...s, root: Root.fromMarkdown(m.text)}, []],
	},
};
const startsWithAHeading: Page = {
	...page,
	init: () => [{root: Root.fromMarkdown("# Page"), waiting: null, cool: false, reads: 0}, []],
};
/** The newest text told while cooling is dropped: the page stays on an old one. */
const dropsTheNewest: Page = {
	...page,
	update: {...page.update, told: (s, m) => (s.cool ? [s, []] : page.update.told(s, m))},
};

describe("the markdown page's laws", () => {
	it.each(LAWS.map((law) => [law.name, law] as const))("%s", (_, law) => {
		law.check(page);
	});

	it("each law is seen to fail on a planted mistake", () => {
		expect(broken(keepsTheFirst)).toEqual([showsWhatItIsTold.name, startsEmpty.name]);
		expect(broken(startsWithAHeading)).toEqual([startsEmpty.name]);
		expect(broken(dropsTheNewest)).toEqual([showsWhatItIsTold.name, startsEmpty.name]);
	});
});
