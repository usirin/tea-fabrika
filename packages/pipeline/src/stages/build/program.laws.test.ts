import {
	arbConstantMsg,
	arbMsg,
	arbRecordMsg,
	foldEvents,
	type MsgArbitraryTable,
	stubCtxThrowingProxy,
} from "@demlik/tea/pbt";
import {type MsgOf, memoryStorage} from "@kampus/fabrika-old";
import {Effect} from "effect";
import * as fc from "fast-check";
import {describe, expect, it} from "vitest";
import {criterionId} from "../../ids.ts";
import {intentOf} from "../../primitives.ts";
import type {Criterion} from "../review/pack.ts";
import {noRun} from "../review/reviewer.ts";
import type {Built, Ran, Settings} from "./form.ts";
import {type Build, build, copyTree, openPr, pushBranch, readTicket} from "./machine.ts";
import {buildKind} from "./program.ts";
import type {Ticket} from "./ticket.ts";

// The build machine as its kind keeps it, on tea's pbt: every state it reaches from its init,
// driven by any list of its Msgs, saves through the schema `buildKind` declares and loads back
// equal. A start after a kill reads it back through that schema and sends again what was in
// flight, so a state the machine can reach and the schema cannot read is a round that cannot go on.
//
// The answers are drawn for one ticket, in any order, late or twice, as a restart may give them.

type Machine = typeof build;
type Msg = MsgOf<Machine>;

const ctx = stubCtxThrowingProxy<undefined>();
const T = "o/r#1";
const NUMBER = 1;
const SETTINGS: Settings = {model: "m", effort: "low", budget: 1};
const CRITERIA: readonly Criterion[] = [
	{id: criterionId("c1"), version: 1, text: "every window opens", checked: false, evidence: null},
	{id: criterionId("c2"), version: 2, text: "the door locks", checked: true, evidence: "a.log"},
];
const ticket = (patch: Partial<Ticket> = {}): Ticket => ({
	url: T,
	number: NUMBER,
	state: "open",
	title: "windows",
	body: "b",
	plan: "approved",
	criteria: CRITERIA,
	prs: [],
	rules: [],
	...patch,
});
/** Tickets the gate lets through. */
const GO: readonly Ticket[] = [ticket(), ticket({prs: [{url: "P", state: "open", head: "h0"}]})];
/** Tickets it stops: no plan read, no criteria, criteria it would guess at, closed, merged. */
const STOP: readonly Ticket[] = [
	(({plan: _, ...rest}) => rest)(ticket()),
	ticket({criteria: null}),
	ticket({criteria: []}),
	ticket({state: "closed"}),
	ticket({prs: [{url: "P", state: "merged", head: "h0"}]}),
];
/** Mostly one the gate lets through, so a round goes on past the read. */
const tickets = fc.oneof(
	{weight: 4, arbitrary: fc.constantFrom(...GO)},
	{weight: 1, arbitrary: fc.constantFrom(...STOP)},
);
const BUILTS: readonly Built[] = [
	{summary: "Opens the windows.", deviations: [], ran: [], left: []},
	{
		summary: "Opens the windows.",
		deviations: ["criterion c1 is met another way"],
		ran: [{command: "pnpm test", passed: true}],
		left: ["criterion c2"],
	},
];
const RANS: readonly Ran[] = [
	noRun,
	{
		spend: {costUsd: 0.42, tokens: 1200, context: 900, turns: 3, minutes: 2},
		tools: ["Read", "Edit"],
		refused: [{tool: "WebFetch", why: "no network"}],
		links: 1,
	},
];

const round = fc.integer({min: 1, max: 2});
const run = fc.integer({min: 1, max: 2});
const ran = fc.constantFrom(...RANS);
const UNKNOWN = {_tag: "unknown"} as const;
const intent = (r: number, step: string) => intentOf("build", T, r, step);
const reads = readTicket({ticket: T, number: NUMBER});
const copyOf = (r: number) => copyTree({ticket: T, number: NUMBER, intent: intent(r, "copy")});
const COPIED = {tree: "work/o-r-1", branch: "build/o-r-1", base: "h0"};
const pushOf = (r: number) =>
	pushBranch({
		ticket: T,
		copied: COPIED,
		message: {title: "windows", round: r, summary: "Opens the windows.", refs: NUMBER},
		intent: intent(r, "push"),
	});
const openOf = (r: number) =>
	openPr({
		ticket: T,
		number: NUMBER,
		title: "windows",
		body: {closes: NUMBER, round: r, summary: "s", deviations: [], ran: [], left: []},
		intent: intent(r, "open"),
	});

/** One entry per Msg type: leaving one out does not compile. */
const table: MsgArbitraryTable<Msg> = {
	start: arbRecordMsg("start", {
		ask: fc.record({
			ticket: fc.constant(T),
			number: fc.constant(NUMBER),
			round,
			open: fc.constantFrom(
				[],
				[
					{
						criterion: criterionId("c2"),
						text: "the door locks",
						says: "no",
						where: ["a.ts:1-2"],
						wants: ["it locks"],
					},
				],
				[{criterion: null, text: "checks red", says: "lint", where: [], wants: []}],
			),
		}),
		settings: fc.constant(SETTINGS),
		session: fc.constantFrom("s1", "s2"),
	}),
	resume: arbConstantMsg("resume"),
	build_ticket_ok: tickets.map((t) => readTicket.ok(reads, t, 0)),
	build_ticket_err: fc.constant(readTicket.err(reads, UNKNOWN, 0)),
	build_copy_ok: round.map((r) => copyTree.ok(copyOf(r), COPIED, 0)),
	build_copy_err: round.map((r) => copyTree.err(copyOf(r), UNKNOWN, 0)),
	build_built: arbRecordMsg("build_built", {
		ticket: fc.constant(T),
		round,
		run,
		built: fc.constantFrom(...BUILTS),
		ran,
	}),
	build_failed: arbRecordMsg("build_failed", {
		ticket: fc.constant(T),
		round,
		run,
		why: fc.constantFrom("broke", "misfit", "over_budget"),
		error: fc.option(fc.constant("the run broke"), {nil: null}),
		ran,
	}),
	build_push_ok: fc
		.tuple(round, fc.boolean())
		.map(([r, changed]) => pushBranch.ok(pushOf(r), {head: "h1", changed}, 0)),
	build_push_err: fc
		.tuple(round, fc.constantFrom(UNKNOWN, {_tag: "exam_touched"} as const))
		.map(([r, why]) => pushBranch.err(pushOf(r), why, 0)),
	build_open_ok: round.map((r) => openPr.ok(openOf(r), "P", 0)),
	build_open_err: round.map((r) => openPr.err(openOf(r), UNKNOWN, 0)),
};
/** Weighted to the answers that move a round on, so every phase is reached. */
const WEIGHTS = {
	build_ticket_ok: 6,
	build_copy_ok: 6,
	build_built: 12,
	build_push_ok: 6,
	build_open_ok: 3,
};
/** A round begins as its parent begins it, with `start`; the rest comes in any order. */
const lists = fc
	.tuple(table.start, fc.array(arbMsg(table, {weights: WEIGHTS}), {maxLength: 30, size: "max"}))
	.map(([first, rest]) => [first, ...rest]);

/**
 * Every state `machine` reaches from its init, saved through the kind's schema and loaded back.
 * `saved`: the phase of each state saved, so a test can say the law held on every shape of state.
 */
const keepsEvery = (machine: Machine, runs = 150, saved = new Set<string>()) =>
	fc.assert(
		fc.asyncProperty(lists, async (list) => {
			const handle = await Effect.runPromise(memoryStorage().open("build:r1", null));
			const store = handle.store("build", T, buildKind.state);
			for (const s of foldEvents(machine, ctx, null, list).states) {
				await store.save(s);
				expect(store.migrate(await store.load())).toEqual(s);
				saved.add(s.phase);
			}
		}),
		{numRuns: runs, seed: 1},
	);

const PHASES = ["idle", "reading", "copying", "building", "pushing", "opening", "over"];

describe("the build machine is kept", () => {
	it("every state it reaches from its init saves and loads back equal, in every phase", async () => {
		const saved = new Set<string>();
		await keepsEvery(build, 150, saved);
		expect([...saved].sort()).toEqual([...PHASES].sort());
	});

	it("the law is seen to fail on a planted mistake: a build that keeps the builder's whole Msg dies at its first save", async () => {
		const keepsTheMsg: Machine = {
			...build,
			update: {
				...build.update,
				build_built: (s, m) => {
					const [next, cmds] = build.update.build_built(s, m);
					return [{...next, ...m} as Build, cmds];
				},
			},
		};
		await expect(keepsEvery(keepsTheMsg, 40)).rejects.toThrow(/Counterexample/);
	});
});

/**
 * A build the guard refused never goes on: whatever came before, it ends `stuck:exam_touched`, with
 * no pull request and no Cmd after it.
 */
const refusedStaysRefused = (machine: Machine) =>
	fc.assert(
		fc.property(lists, (list) => {
			const {states} = foldEvents(machine, ctx, null, list);
			list.forEach((msg, i) => {
				const before = states[i];
				const after = states[i + 1];
				if (
					msg.type !== "build_push_err" ||
					msg.error._tag !== "exam_touched" ||
					before?.phase !== "pushing" ||
					msg.cmd.ticket !== before.asked.ticket
				)
					return;
				expect(after).toMatchObject({phase: "over", outcome: {kind: "stuck", why: "exam_touched"}});
			});
		}),
		{numRuns: 300, seed: 2},
	);

describe("the builder cannot touch the exam", () => {
	it("a change to the test writer's files ends the build in a named stuck", () => {
		refusedStaysRefused(build);
	});

	it("the law is seen to fail on a planted mistake: a refused change read as a push that failed", () => {
		const planted: Machine = {
			...build,
			update: {
				...build.update,
				build_push_err: (s, m) => build.update.build_push_err(s, {...m, error: UNKNOWN}),
			},
		};
		expect(() => refusedStaysRefused(planted)).toThrow();
	});
});
