import {applyCell} from "@demlik/tea";
import {noSpend} from "@kampus/fabrika/agents/claude";
import {describe, expect, it} from "vitest";
import {criterionId} from "../../ids.ts";
import {msgOf} from "./handlers.ts";
import {
	checksClock,
	checksSub,
	createReview,
	DEFAULT_TRIES,
	DEFAULT_WAITS,
	fileNote,
	gatherPack,
	MAX_RUNS,
	problemsOf,
	type Review,
	type ReviewCmd,
	review,
	runSub,
	sentBackForm,
} from "./machine.ts";
import type {Ran, Settings} from "./reviewer.ts";
import {briefOf, WHOLE} from "./scripted.ts";
import type {Form} from "./sheet.ts";
import {type Note, noteIdOf} from "./tools.ts";

// The review machine, one step at a time: a state, a Msg, and what comes
// out. No engine, no service, no agent. What the engine adds (the reviewer's
// run as a Sub, its stream, the Act's handler) is in ./program.test.ts.

type AnyMsg = {readonly type: string; readonly [field: string]: unknown};
const step = (s: Review, msg: AnyMsg) => applyCell<Review, AnyMsg, ReviewCmd>(review, s, msg);

const BRIEF = briefOf(WHOLE);
const PR = WHOLE.pr;
const HEAD = WHOLE.head;
const SETTINGS: Settings = {model: "opus", effort: "medium", budget: 2};
const ASK = {pr: PR, head: null, rubrics: "rubrics"};
const RAN: Ran = {spend: noSpend, tools: ["Read"], refused: [], links: 0};
const held = {ask: ASK, settings: SETTINGS, waits: DEFAULT_WAITS, limit: DEFAULT_TRIES} as const;
const NOTE: Note = {title: "An old doc is stale", body: "It names a flag that is gone.", at: null};
const OTHER: Note = {
	title: "A test elsewhere is skipped",
	body: "It has been for a year.",
	at: null,
};

const reviewing = (patch: Partial<Extract<Review, {phase: "reviewing"}>> = {}): Review => ({
	...held,
	phase: "reviewing",
	brief: BRIEF,
	replay: false,
	run: 1,
	tries: 1,
	cuts: 0,
	note: null,
	refusals: [],
	spent: 0,
	notes: [],
	...patch,
});
const from = (run = 1) => ({pr: PR, head: HEAD, run});
const passing = (): Form => ({
	rows: BRIEF.criteria.map((c) => ({
		id: c.id,
		grade: "pass" as const,
		where: [],
		says: "yes",
		limit: null,
	})),
	findings: [],
	skipped: [],
});

describe("the review machine, one step at a time", () => {
	it("starts by reading the pack, at the commit asked for, with the settings kept in its state", () => {
		const [s, cmds] = step({phase: "idle"}, {type: "start", ask: ASK, settings: SETTINGS});
		expect(s).toMatchObject({phase: "gathering", settings: SETTINGS, waits: DEFAULT_WAITS});
		expect(cmds).toEqual([gatherPack({pr: PR, head: null, rubrics: "rubrics"})]);
	});

	it("goes to reviewing on a pack the gate lets through, and its reviewer's run is a Sub on only then", () => {
		const [gathering, [read]] = step(
			{phase: "idle"},
			{type: "start", ask: ASK, settings: SETTINGS},
		);
		const [s, cmds] = step(gathering, {type: gatherPack.okType, cmd: read, value: WHOLE});
		expect(s).toMatchObject({phase: "reviewing", run: 1, notes: []});
		expect(cmds).toEqual([]);
		expect(runSub.deps(s)).toEqual({
			pr: PR,
			head: HEAD,
			run: 1,
			brief: BRIEF,
			settings: SETTINGS,
			note: null,
		});
		expect(runSub.deps(gathering)).toBeNull();
		expect(checksSub.deps(s)).toBeNull();
		expect(checksClock.deps(s)).toBeNull();
	});

	it("keeps a note the agent filed, and files it with an Act whose intent is in the state first", () => {
		const [s, cmds] = step(reviewing(), {type: "review_note", ...from(), note: NOTE});
		const id = noteIdOf(NOTE);
		const cmd = fileNote({pr: PR, id, note: NOTE, intent: `review/${PR}/${HEAD}/note/${id}`});
		expect(cmds).toEqual([cmd]);
		expect(s).toMatchObject({
			phase: "reviewing",
			notes: [{id, note: NOTE, state: "asked", asked: cmd}],
		});
	});

	it("keeps a note said twice once: the same title is the same note", () => {
		const [once] = step(reviewing(), {type: "review_note", ...from(), note: NOTE});
		const [twice, cmds] = step(once, {
			type: "review_note",
			...from(),
			note: {...NOTE, body: "again, in other words"},
		});
		expect(twice).toEqual(once);
		expect(cmds).toEqual([]);
	});

	it("takes nothing from a run that is not this one, or when it is not reviewing", () => {
		const s = reviewing({run: 2});
		expect(step(s, {type: "review_note", ...from(1), note: NOTE})).toEqual([s, []]);
		expect(step(s, {type: "review_reviewed", ...from(1), form: passing(), ran: RAN})).toEqual([
			s,
			[],
		]);
		const over: Review = {
			...held,
			phase: "over",
			outcome: {kind: "stuck", why: "read_failed"},
			report: {} as never,
		};
		expect(step(over, {type: "review_note", ...from(1), note: NOTE})).toEqual([over, []]);
	});

	it("waits in judging for the notes still being filed, and is over once each is", () => {
		const [one, [first]] = step(reviewing(), {type: "review_note", ...from(), note: NOTE});
		const [two, [second]] = step(one, {type: "review_note", ...from(), note: OTHER});
		const [judging, none] = step(two, {
			type: "review_reviewed",
			...from(),
			form: passing(),
			ran: RAN,
		});
		expect(judging).toMatchObject({phase: "judging", outcome: {kind: "done"}});
		expect(none).toEqual([]);
		const [still] = step(judging, {type: fileNote.okType, cmd: first, value: "kept"});
		expect(still.phase).toBe("judging");
		const [over] = step(still, {type: fileNote.errType, cmd: second, error: {_tag: "unknown"}});
		expect(over).toMatchObject({phase: "over", outcome: {kind: "done", part: false, head: HEAD}});
		if (over.phase !== "over") throw new Error("not over");
		expect(over.report.notes.map((n) => [n.title, n.state])).toEqual([
			[NOTE.title, "kept"],
			[OTHER.title, "failed"],
		]);
		expect(over.report.criteria.every((c) => c.state === "met")).toBe(true);
	});

	it("a run that left no form is a declared outcome, and its notes are filed all the same", () => {
		const [one] = step(reviewing(), {type: "review_note", ...from(), note: NOTE});
		const [s] = step(one, {
			type: "review_failed",
			...from(),
			why: "over_budget",
			error: null,
			ran: RAN,
		});
		expect(s).toMatchObject({phase: "judging", outcome: {kind: "stuck", why: "over_budget"}});
		const [broke] = step(reviewing(), {
			type: "review_failed",
			...from(),
			why: "broke",
			error: "it fell over",
			ran: RAN,
		});
		expect(broke).toMatchObject({
			phase: "over",
			outcome: {kind: "stuck", why: "draft_failed"},
			report: {problems: ["it fell over"]},
		});
	});
});

describe("a form the Check refuses", () => {
	// No rows at all: every criterion is missing its row.
	const refused = (): Form => ({rows: [], findings: [], skipped: []});
	const paid = (costUsd: number): Ran => ({...RAN, spend: {...noSpend, costUsd}});
	const why = BRIEF.criteria.map((c) => `criterion ${c.id} has no row`);

	it("goes back to the reviewer for another try, told the problems and the form, with the problems kept", () => {
		const [s, cmds] = step(reviewing(), {
			type: "review_reviewed",
			...from(),
			form: refused(),
			ran: paid(0.4),
		});
		expect(cmds).toEqual([]);
		expect(s).toMatchObject({phase: "reviewing", run: 2, tries: 2, refusals: [why], spent: 0.4});
		const deps = runSub.deps(s);
		expect(deps).toMatchObject({run: 2});
		expect(deps?.note).toBe(sentBackForm(refused())(why as [string, ...string[]]));
		for (const problem of why) expect(deps?.note).toContain(problem);
	});

	it("a second refusal ends stuck on draft_failed, and the report keeps both forms' problems and both runs' cost", () => {
		const [again] = step(reviewing(), {
			type: "review_reviewed",
			...from(),
			form: refused(),
			ran: paid(0.4),
		});
		const [s] = step(again, {
			type: "review_reviewed",
			...from(2),
			form: {...refused(), skipped: [{what: "x", why: "y"}]},
			ran: paid(0.3),
		});
		expect(s).toMatchObject({phase: "over", outcome: {kind: "stuck", why: "draft_failed"}});
		if (s.phase !== "over") throw new Error("not over");
		expect(s.report.problems).toEqual(why);
		expect(s.report.refusals).toEqual([why, why]);
		expect(s.report.cost).toBeCloseTo(0.7);
		expect(s.report.runs).toBe(2);
		// What the loop is handed: every refusal, said once, numbered by form.
		expect(problemsOf(s.report)).toEqual([
			...why.map((p) => `form 1 refused: ${p}`),
			...why.map((p) => `form 2 refused: ${p}`),
		]);
	});

	it("a form that passes on the second try keeps the first one's problems and cost in the report", () => {
		const [again] = step(reviewing(), {
			type: "review_reviewed",
			...from(),
			form: refused(),
			ran: paid(0.4),
		});
		const [s] = step(again, {
			type: "review_reviewed",
			...from(2),
			form: passing(),
			ran: paid(0.5),
		});
		expect(s).toMatchObject({phase: "over", outcome: {kind: "done"}});
		if (s.phase !== "over") throw new Error("not over");
		expect(s.report.refusals).toEqual([why]);
		expect(s.report.cost).toBeCloseTo(0.9);
		expect(problemsOf(s.report)).toEqual(why.map((p) => `form 1 refused: ${p}`));
	});

	it("a review made with one try ends on the first refusal, its problems kept", () => {
		const once = createReview({tries: 1});
		const on = (s: Review, msg: AnyMsg) => applyCell<Review, AnyMsg, ReviewCmd>(once, s, msg);
		const [gathering, [read]] = on({phase: "idle"}, {type: "start", ask: ASK, settings: SETTINGS});
		const [reviewingNow] = on(gathering, {type: gatherPack.okType, cmd: read, value: WHOLE});
		const [s] = on(reviewingNow, {
			type: "review_reviewed",
			...from(),
			form: refused(),
			ran: paid(0.4),
		});
		expect(s).toMatchObject({
			phase: "over",
			outcome: {kind: "stuck", why: "draft_failed"},
			report: {problems: why, refusals: [why]},
		});
	});

	it("a cut-off run started again does not use up a try, and a try does not use up a restart", () => {
		const [again] = step(reviewing(), {
			type: "review_reviewed",
			...from(),
			form: refused(),
			ran: paid(0.4),
		});
		const [resumed] = step(again, {type: "resume"});
		expect(resumed).toMatchObject({phase: "reviewing", run: 3, tries: 2, cuts: 1});
	});
});

describe("a restart", () => {
	it("in reviewing starts the reviewer again as a new run, keeps the notes so far, and files again those not yet answered", () => {
		const [one, [asked]] = step(reviewing(), {type: "review_note", ...from(), note: NOTE});
		const [again, cmds] = step(one, {type: "resume"});
		expect(again).toMatchObject({
			phase: "reviewing",
			run: 2,
			notes: [{id: noteIdOf(NOTE), state: "asked"}],
		});
		expect(cmds).toEqual([asked]);
		// A new run is a new Sub: the engine starts it, and drops the old one's Msgs.
		expect(runSub.deps(again)).toMatchObject({run: 2});
		// The agent of the new run files the same note again: it is kept once.
		expect(step(again, {type: "review_note", ...from(2), note: NOTE})[1]).toEqual([]);
	});

	it(`starts the reviewer at most ${MAX_RUNS} times: a run cut off after that is over budget`, () => {
		const [s] = step(reviewing({run: MAX_RUNS, cuts: MAX_RUNS - 1}), {type: "resume"});
		expect(s).toMatchObject({
			phase: "over",
			outcome: {kind: "stuck", why: "over_budget"},
			report: {runs: MAX_RUNS},
		});
	});

	it("in gathering asks the same read again, and in judging files again the notes not yet answered", () => {
		const [gathering, [read]] = step(
			{phase: "idle"},
			{type: "start", ask: ASK, settings: SETTINGS},
		);
		expect(step(gathering, {type: "resume"})).toEqual([gathering, [read]]);
		const [one, [asked]] = step(reviewing(), {type: "review_note", ...from(), note: NOTE});
		const [judging] = step(one, {type: "review_reviewed", ...from(), form: passing(), ran: RAN});
		expect(step(judging, {type: "resume"})).toEqual([judging, [asked]]);
	});
});

describe("what the reviewer's run says, as Msgs", () => {
	const at = from(3);

	it("a note is a note, and a form that fits its schema is the form", () => {
		expect(msgOf(at)({kind: "note", note: NOTE})).toEqual({type: "review_note", ...at, note: NOTE});
		expect(msgOf(at)({kind: "ended", drafted: {answer: "form", form: passing(), ...RAN}})).toEqual({
			type: "review_reviewed",
			...at,
			form: passing(),
			ran: RAN,
		});
	});

	it("a form that does not fit its schema never reaches the machine as a form: it is a misfit", () => {
		// TypeScript takes it; the schema does not: a line that is not a number.
		const bad: Form = {
			...passing(),
			skipped: [],
			rows: [
				{
					id: BRIEF.criteria[0]?.id ?? criterionId("c1"),
					grade: "pass",
					where: [{file: "a.ts", first: Number.NaN, last: 1}],
					says: "yes",
					limit: null,
				},
			],
		};
		expect(msgOf(at)({kind: "ended", drafted: {answer: "form", form: bad, ...RAN}})).toEqual({
			type: "review_failed",
			...at,
			why: "misfit",
			error: null,
			ran: RAN,
		});
	});

	it("every other end is a declared failure", () => {
		expect(msgOf(at)({kind: "ended", drafted: {answer: "over_budget", ...RAN}})).toMatchObject({
			type: "review_failed",
			why: "over_budget",
		});
		expect(msgOf(at)({kind: "ended", drafted: {answer: "misfit", ...RAN}})).toMatchObject({
			type: "review_failed",
			why: "misfit",
		});
		expect(
			msgOf(at)({kind: "ended", drafted: {answer: "broke", error: "x", ...RAN}}),
		).toMatchObject({type: "review_failed", why: "broke", error: "x"});
	});
});
