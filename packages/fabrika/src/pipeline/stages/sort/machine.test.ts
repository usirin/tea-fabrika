import {applyCell} from "@demlik/tea";
import {describe, expect, it} from "vitest";
import type {Spend} from "../../draft.ts";
import type {SortAnswer, SortReply} from "./answer.ts";
import {NO_RULE_IDS, NO_RULES, STILL_YES} from "./bar.ts";
import {promptOf, sortProblems} from "./brief.ts";
import {
	readContext,
	readTicket,
	runSub,
	type SortCmd,
	type SortState,
	sort,
	writeOne,
} from "./machine.ts";
import {reasonIn, type Settings, type SortContext, type SortTicket} from "./services.ts";
import {writesFor} from "./writes.ts";

// The sort machine, one step at a time: a state, a Msg, and what comes out. No engine, no service,
// no agent. Then the pure parts it leans on: the Check, the writes, the reason a later sort reads.

type AnyMsg = {readonly type: string; readonly [field: string]: unknown};
const step = (s: SortState, msg: AnyMsg) => applyCell<SortState, AnyMsg, SortCmd>(sort, s, msg);

const URL = "https://github.com/acme/widgets/issues/12";
const SETTINGS: Settings = {model: "haiku", effort: "low", budget: 0.2, note: "A widget library."};
const TICKET: SortTicket = {
	url: URL,
	number: 12,
	state: "open",
	title: "Widgets render twice on resize",
	body: "Resize the window: each widget draws two times.",
};
const CONTEXT: SortContext = {
	earlier: [
		{number: 4, title: "Widgets draw twice when the window resizes", state: "open", reason: null},
		{
			number: 3,
			title: "Add a dark theme",
			state: "closed",
			reason: "No: won't do: already ruled out; reopen only with a new fact",
		},
	],
	plans: [{number: 8, tickets: [8, 9], summary: "Resize handling, end to end.", approved: true}],
};
const SPENT: Spend = {costUsd: 0.01, tokens: 900, context: 900, turns: 1, minutes: 0.1};

/** From idle to the sorter's first answer asked for. */
function sorting(tries = 2): SortState {
	const [reading, [read]] = step(
		{phase: "idle"},
		{type: "start", ask: {ticket: URL, tries}, settings: SETTINGS, key: "sort:12"},
	);
	const [gathering, [gather]] = step(reading, {type: readTicket.okType, cmd: read, value: TICKET});
	return step(gathering, {type: readContext.okType, cmd: gather, value: CONTEXT})[0];
}
const runOf = (s: SortState) => runSub.deps(s)?.run ?? null;
const finished = (s: SortState, answer: SortAnswer | null) => ({
	type: "sort_finished",
	key: "sort:12",
	id: runOf(s)?.id,
	output: answer === null ? null : ({sort: answer} satisfies SortReply),
	session: "s",
	spend: SPENT,
});

/** Every write answered in turn: the state at the end, and the writes that went out. */
function writeAll(s: SortState): {readonly end: SortState; readonly sent: readonly SortCmd[]} {
	const sent: SortCmd[] = [];
	let now = s;
	for (let i = 0; i < 10 && now.phase === "writing"; i++) {
		sent.push(now.asked);
		now = step(now, {type: writeOne.okType, cmd: now.asked, value: null})[0];
	}
	return {end: now, sent};
}

/** The door passed with the ticket as first read. */
const door = (s: SortState) =>
	s.phase === "checking"
		? step(s, {type: readTicket.okType, cmd: s.asked, value: TICKET})
		: ([s, []] as const);

describe("the sort machine", () => {
	it("reads the ticket, then its repo's tickets and open plans, then asks the sorter with all of them", () => {
		const s = sorting();
		expect(s.phase).toBe("sorting");
		const run = runOf(s);
		expect(run).toMatchObject({id: "sort:12/1", session: {continues: false}});
		expect(run?.prompt).toContain(TICKET.title);
		expect(run?.prompt).toContain("#4 (open) Widgets draw twice");
		expect(run?.prompt).toContain("closed by sort: No: won't do");
		expect(run?.prompt).toContain("plan #8 (approved), covering #8, #9");
	});

	it("skips a ticket closed already, and writes nothing", () => {
		const [reading, [read]] = step(
			{phase: "idle"},
			{type: "start", ask: {ticket: URL, tries: 2}, settings: SETTINGS, key: "k"},
		);
		const [over, cmds] = step(reading, {
			type: readTicket.okType,
			cmd: read,
			value: {...TICKET, state: "closed"},
		});
		expect(over).toMatchObject({phase: "over", outcome: {kind: "skip", why: "closed"}});
		expect(cmds).toEqual([]);
	});

	it("reads the ticket again before the first write, then writes a duplicate's three writes in order", () => {
		const s = sorting();
		const [checking, cmds] = step(s, finished(s, {answer: "duplicate", of: 4, why: "Same bug."}));
		expect(checking.phase).toBe("checking");
		expect(cmds).toEqual([readTicket({ticket: URL})]);
		const [writing] = door(checking);
		const {end, sent} = writeAll(writing);
		expect(sent.map((c) => c.type === "sort_write" && c.write.op)).toEqual([
			"comment",
			"label",
			"close",
		]);
		expect(sent.map((c) => c.type === "sort_write" && c.intent)).toEqual([
			`sort/${URL}/1/comment`,
			`sort/${URL}/2/label`,
			`sort/${URL}/3/close`,
		]);
		expect(end).toMatchObject({
			phase: "over",
			outcome: {kind: "done", closed: "duplicate"},
			report: {tries: 1, spend: {costUsd: 0.01}},
		});
	});

	it("writes nothing when the ticket closed or changed while it was sorted", () => {
		const s = sorting();
		const [checking] = step(s, finished(s, {answer: "duplicate", of: 4, why: "Same bug."}));
		if (checking.phase !== "checking") throw new Error("no door");
		const [closed, none] = step(checking, {
			type: readTicket.okType,
			cmd: checking.asked,
			value: {...TICKET, state: "closed"},
		});
		expect(closed).toMatchObject({phase: "over", outcome: {kind: "skip", why: "closed"}});
		expect(none).toEqual([]);
		const [changed, nothing] = step(checking, {
			type: readTicket.okType,
			cmd: checking.asked,
			value: {...TICKET, body: "Now it is about colours."},
		});
		expect(changed).toMatchObject({phase: "over", outcome: {kind: "stuck", why: "changed"}});
		expect(nothing).toEqual([]);
	});

	it("sends an answer the Check fails back with the whole brief, and folds on the second", () => {
		const s = sorting();
		const [again] = step(s, finished(s, {answer: "yes", next: "plan", partOf: 99, why: "Resize."}));
		const run = runOf(again);
		expect(run?.id).toBe("sort:12/2");
		expect(run?.prompt).toContain(TICKET.title);
		expect(run?.prompt).toContain("plan #99 is not one of the open plans listed");
		const [checking] = step(
			again,
			finished(again, {answer: "yes", next: "plan", partOf: 8, why: "Resize."}),
		);
		const {end, sent} = writeAll(door(checking)[0]);
		expect(sent.at(-1)).toMatchObject({
			write: {op: "link", plan: "https://github.com/acme/widgets/issues/8"},
		});
		expect(end).toMatchObject({
			outcome: {kind: "send", to: "plan", why: "fold"},
			report: {tries: 2, spend: {costUsd: 0.02}},
		});
	});

	it("stops on a refused write, and keeps what went out", () => {
		const s = sorting();
		const [checking] = step(
			s,
			finished(s, {answer: "no", rule: "not_work", reason: "won't do: not a work item", why: "Q."}),
		);
		const [writing] = door(checking);
		if (writing.phase !== "writing") throw new Error("not writing");
		const [second] = step(writing, {type: writeOne.okType, cmd: writing.asked, value: null});
		if (second.phase !== "writing") throw new Error("not writing");
		const [end] = step(second, {
			type: writeOne.errType,
			cmd: second.asked,
			error: {_tag: "unknown"},
		});
		expect(end).toMatchObject({
			outcome: {kind: "stuck", why: "write_failed"},
			report: {wrote: [{op: "comment"}], problems: ["the label write was refused"]},
		});
	});

	it("sends the write in flight again on a restart, with the same intent", () => {
		const s = sorting();
		const [checking] = step(s, finished(s, {answer: "duplicate", of: 4, why: "Same bug."}));
		const [writing] = door(checking);
		if (writing.phase !== "writing") throw new Error("not writing");
		const [, cmds] = step(writing, {type: "resume"});
		expect(cmds).toEqual([writing.asked]);
	});

	it("stops over budget when the sorter reaches its limit", () => {
		const s = sorting();
		const [end] = step(s, {
			type: "sort_failed",
			key: "sort:12",
			id: runOf(s)?.id,
			error: "error_max_budget_usd",
			spend: SPENT,
		});
		expect(end).toMatchObject({outcome: {kind: "stuck", why: "over_budget"}});
	});
});

describe("the Check", () => {
	const brief = {ticket: TICKET, context: CONTEXT, note: ""};
	const problems = (sort: SortAnswer) => sortProblems({sort}, brief);

	it("passes a duplicate of a listed ticket, and sends back one of itself or of one not listed", () => {
		expect(problems({answer: "duplicate", of: 4, why: "w"})).toEqual([]);
		expect(problems({answer: "duplicate", of: 12, why: "w"})).toHaveLength(1);
		expect(problems({answer: "duplicate", of: 40, why: "w"})).toHaveLength(1);
	});

	it("asks a no's reason to start with its rule's lead, on one line", () => {
		expect(
			problems({
				answer: "no",
				rule: "pipeline_tool",
				reason: "won't do here: a tool bug",
				why: "w",
			}),
		).toEqual([]);
		expect(
			problems({answer: "no", rule: "pipeline_tool", reason: "superseded: elsewhere", why: "w"}),
		).toHaveLength(1);
		expect(
			problems({answer: "no", rule: "not_work", reason: "won't do: not\na work item", why: "w"}),
		).toHaveLength(1);
	});

	it("asks a ruling for an ask and two options", () => {
		expect(
			problems({answer: "yes", next: "ruling", ask: "Which?", options: ["a", "b"], why: "w"}),
		).toEqual([]);
		expect(
			problems({answer: "yes", next: "ruling", ask: "", options: ["a"], why: "w"}),
		).toHaveLength(2);
	});

	it("states the bar in the prompt, all seven noes and the four yeses that stay", () => {
		const text = promptOf(brief);
		expect(NO_RULE_IDS).toEqual(NO_RULES.map((r) => r.id));
		for (const id of NO_RULE_IDS) expect(text).toContain(`\`${id}\``);
		for (const yes of STILL_YES) expect(text).toContain(yes.rule);
	});
});

describe("the writes and the reason a later sort reads", () => {
	it("makes a no's comment start with No and the reason, which reasonIn reads back", () => {
		const [comment] = writesFor(TICKET, {
			answer: "no",
			rule: "settled_no",
			reason: "won't do: already ruled out; reopen only with a new fact",
			why: "Ruled out in #3.",
		});
		if (comment?.op !== "comment") throw new Error("no comment first");
		const posted = `${comment.body}\n\n<!-- fabrika-key: sort:12#comment:${URL} -->`;
		expect(reasonIn(["a person's comment", posted])).toBe(
			"No: won't do: already ruled out; reopen only with a new fact",
		);
		expect(reasonIn(["No: a person said so"])).toBeNull();
	});

	it("gives a yes for research a comment and a label, and nothing else", () => {
		expect(
			writesFor(TICKET, {answer: "yes", next: "research", why: "Unknown yet."}).map((w) => w.op),
		).toEqual(["comment", "label"]);
	});
});
