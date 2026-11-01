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
import {fileNote, gatherPack, MAX_WAITS, Review, review} from "./machine.ts";
import type {Criterion, Deviations, Pack} from "./pack.ts";
import {noRun, type Ran, type Settings} from "./reviewer.ts";
import type {Form, Row} from "./sheet.ts";
import {type Note, noteIdOf} from "./tools.ts";

// The review machine as its kind keeps it, on tea's pbt: every state it reaches from its init,
// driven by any list of its Msgs, saves through `Review`, the schema the kind declares
// (./program.ts), and loads back equal. A start after a kill reads it back through that schema
// and goes on from where it stood, so a state the machine can reach and the schema cannot read is
// a review that cannot go on.
//
// Beside the kind, not the machine: the review machine is made in a factory, under no name.

type Machine = typeof review;
type Msg = MsgOf<Machine>;

const ctx = stubCtxThrowingProxy<undefined>();
const PR = "o/r#7";
const HEADS = ["A", "B"] as const;
const SETTINGS: Settings = {model: "m", effort: "low", budget: 1};
const c = (n: number) => criterionId(`c${n}`);
const CRITERIA: readonly Criterion[] = [
	{id: c(1), version: 1, text: "every window opens", checked: false, evidence: null},
	{id: c(2), version: 2, text: "the door locks", checked: false, evidence: "door.log"},
];
const DEVIATIONS: readonly Deviations[] = [
	{state: "none"},
	{state: "listed", text: "criterion c1 is met another way"},
];
const packAt = (head: string, checks: Pack["checks"]["state"], deviations: Deviations): Pack => ({
	pr: PR,
	head,
	replay: false,
	state: "open",
	ticket: {id: "T", link: "closes_it"},
	criteria: [...CRITERIA],
	files: [{path: "a.ts", kind: "review-code"}],
	kinds: ["review-code"],
	diff: "d",
	deviations,
	checks: {state: checks, required: []},
	rules: [],
	rubrics: [{kind: "review-code", text: "r"}],
});
/** Mostly packs the gate lets through, so a review goes on to its reviewer. */
const packs = fc.oneof(
	{
		weight: 3,
		arbitrary: fc
			.tuple(fc.constantFrom(...HEADS), fc.constantFrom(...DEVIATIONS))
			.map(([head, deviations]) => packAt(head, "green", deviations)),
	},
	{
		weight: 1,
		arbitrary: fc
			.tuple(fc.constantFrom(...HEADS), fc.constantFrom("pending", "red" as const))
			.map(([head, checks]) => packAt(head, checks, {state: "none"})),
	},
);
const pass = (n: number): Row => ({id: c(n), grade: "pass", where: [], says: "seen", limit: null});
const FORMS: readonly Form[] = [
	{rows: [pass(1), pass(2)], findings: [], skipped: []},
	{
		rows: [
			{id: c(1), grade: "fail", where: [{file: "a.ts", first: 1, last: 2}], says: "stuck shut"},
			pass(2),
		],
		findings: [
			{
				kind: "review-code",
				from: {source: "criterion", id: c(1)},
				fault: "criterion 1 is not met",
				at: {file: "a.ts", first: 1, last: 2},
				proof: "p",
				wants: "criterion 1 met",
			},
		],
		skipped: [],
	},
	{
		rows: [pass(1), {id: c(2), grade: "unseen", says: "no lock in the diff"}],
		findings: [],
		skipped: [],
	},
	/** No row for c2: the Check refuses it, and the reviewer tries again. */
	{rows: [pass(1)], findings: [], skipped: []},
];
const NOTES: readonly Note[] = [
	{title: "t", body: "b", at: null},
	{title: "the lock is never tested", body: "c", at: {file: "door.ts", first: 3, last: 3}},
];
const RANS: readonly Ran[] = [
	noRun,
	{
		spend: {costUsd: 0.3, tokens: 900, context: 700, turns: 2, minutes: 1},
		tools: ["Read"],
		refused: [],
		links: 0,
	},
];
const head = fc.constantFrom(...HEADS);
const run = fc.integer({min: 1, max: 3});
const note = fc.constantFrom(...NOTES);
const UNKNOWN = {_tag: "unknown"} as const;
const fileOf = (h: string, n: Note) => {
	const id = noteIdOf(n);
	return fileNote({pr: PR, id, note: n, intent: intentOf("review", PR, h, "note", id)});
};
const reads = gatherPack({pr: PR, head: null, rubrics: "r"});

/** One entry per Msg type: leaving one out does not compile. */
const table: MsgArbitraryTable<Msg> = {
	start: arbRecordMsg("start", {
		ask: fc.constant({pr: PR, head: null, rubrics: "r"}),
		settings: fc.constant(SETTINGS),
	}),
	resume: arbConstantMsg("resume"),
	review_pack_ok: packs.map((p) => gatherPack.ok(reads, p, 0)),
	review_pack_err: fc.constant(gatherPack.err(reads, UNKNOWN, 0)),
	review_checks: arbRecordMsg("review_checks", {pr: fc.constant(PR), head}),
	review_checks_overdue: arbRecordMsg("review_checks_overdue", {
		pr: fc.constant(PR),
		head,
		wait: fc.integer({min: 0, max: MAX_WAITS}),
	}),
	review_note: arbRecordMsg("review_note", {pr: fc.constant(PR), head, run, note}),
	review_reviewed: arbRecordMsg("review_reviewed", {
		pr: fc.constant(PR),
		head,
		run,
		form: fc.constantFrom(...FORMS),
		ran: fc.constantFrom(...RANS),
	}),
	review_failed: arbRecordMsg("review_failed", {
		pr: fc.constant(PR),
		head,
		run,
		why: fc.constantFrom("broke", "misfit", "over_budget"),
		error: fc.option(fc.constant("the run broke"), {nil: null}),
		ran: fc.constantFrom(...RANS),
	}),
	review_file_note_ok: fc.tuple(head, note).map(([h, n]) => fileNote.ok(fileOf(h, n), "kept", 0)),
	review_file_note_err: fc
		.tuple(head, note)
		.map(([h, n]) => fileNote.err(fileOf(h, n), UNKNOWN, 0)),
};
/** Weighted to what moves a review on, so every phase is reached. */
const WEIGHTS = {review_pack_ok: 4, review_note: 3, review_reviewed: 6, review_file_note_ok: 4};
/** A review begins as its parent begins it, with `start`; the rest comes in any order. */
const lists = fc
	.tuple(table.start, fc.array(arbMsg(table, {weights: WEIGHTS}), {maxLength: 30, size: "max"}))
	.map(([start, rest]) => [start, ...rest]);

/**
 * Every state `machine` reaches from its init, saved through the kind's schema and loaded back.
 * `saved`: the phase of each state saved, so a test can say the law held on every shape of state.
 */
const keepsEvery = (machine: Machine, runs = 150, saved = new Set<string>()) =>
	fc.assert(
		fc.asyncProperty(lists, async (list) => {
			const handle = await Effect.runPromise(memoryStorage().open("review:r1", null));
			const store = handle.store("review", PR, Review);
			for (const s of foldEvents(machine, ctx, null, list).states) {
				await store.save(s);
				expect(store.migrate(await store.load())).toEqual(s);
				saved.add(s.phase);
			}
		}),
		{numRuns: runs, seed: 1},
	);

const PHASES = ["idle", "gathering", "waiting", "reviewing", "judging", "over"];

describe("the review machine is kept", () => {
	it("every state it reaches from its init saves and loads back equal, in every phase", async () => {
		const saved = new Set<string>();
		await keepsEvery(review, 150, saved);
		expect([...saved].sort()).toEqual([...PHASES].sort());
	});

	it("the law is seen to fail on a planted mistake: a review that keeps the reviewer's whole Msg dies at its first save", async () => {
		const keepsTheMsg: Machine = {
			...review,
			update: {
				...review.update,
				review_note: (s, m) => {
					const [next, cmds] = review.update.review_note(s, m);
					return [{...next, ...m} as Review, cmds];
				},
			},
		};
		await expect(keepsEvery(keepsTheMsg, 40)).rejects.toThrow(/Counterexample/);
	});
});
