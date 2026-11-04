import {foldUpdates} from "@demlik/tea";
import type {MsgOf} from "@kampus/fabrika-old";
import {Schema} from "effect";
import {describe, expect, it} from "vitest";
import {make} from "../../entity.ts";
import {LaneId} from "../../ids.ts";
import {Entry} from "../../tickets/ticket.ts";
import {HeldDraft} from "../plan/plan.ts";
import {claimLane, EMPTY, freshMain, Lane, type LaneCmd, lane, readFiled} from "./machine.ts";
import {LANE_NAMES} from "./outcome.ts";
import {FINAL, type Folded, firstRun, fold, nextAttempt, runId, Seen} from "./restart.ts";

// Self-fix PR 5: what may restart, and the carry from facts. Today's version.
//
//   FINAL: the closed list of stops that never restart.
//   fold(seen): a stop's `Held` rebuilt from the ticket's facts and the commits code made, with each
//   field no fact proves named, and the step the lane goes on at: the one that writes that field.

const OWNER = {kind: "user", id: "owner"};
const LANE = {kind: "agent", id: "lane", for: "owner"};
const BASE = `5d38d582${"a".repeat(32)}`;
const EXAM_COMMIT = "1".repeat(40);
const BUILT = "2".repeat(40);
const STORY = {id: "reader", who: "a reader", want: "one form", why: "names match"};
const PLAN = Schema.decodeUnknownSync(HeldDraft)({
	summary: "One form.",
	stories: [STORY],
	tasks: [],
	pointers: [],
	questions: [],
});
const DONE = {kind: "done", part: false};
const GREEN = {
	head: BUILT,
	commands: [{command: "node_modules/.bin/vitest run", code: 0, ms: 4_210}],
	result: "green",
	failed: [],
};

/** Ticket 7's facts, in order, as a lane stuck at its mutation step left them. */
const TIMELINE = (() => {
	const facts: (readonly [unknown, Readonly<Record<string, unknown>>])[] = [];
	const ran = (stage: string, run: string, outcome: unknown, between: readonly unknown[] = []) => {
		facts.push([LANE, {type: "started", run, stage, task: null, log: null}]);
		for (const fact of between) facts.push([LANE, fact as Readonly<Record<string, unknown>>]);
		facts.push([LANE, {type: "ended", run, stage, outcome, usd: 0, input: 0, output: 0, turns: 1}]);
	};
	facts.push([OWNER, {type: "filed", title: "Read names in one form", body: "Lower case."}]);
	ran("triage", "r1", {kind: "send", to: "plan", why: "yes"});
	ran("plan", "r2", DONE, [{type: "planned", version: 1, tasks: []}]);
	facts.push([
		LANE,
		{type: "asked", ask: "a-approve-3", what: "Do you approve plan v1?", picks: ["approve", "no"]},
	]);
	facts.push([OWNER, {type: "answered", ask: "a-approve-3", pick: "approve", note: ""}]);
	ran("exam", "r3", {kind: "skip", why: "no_rules_change"});
	ran("test_writer", "r4", DONE);
	ran("build", "r5", DONE, [{type: "checked", ...GREEN}]);
	ran("mutation", "r6", {kind: "stuck", why: "run_failed"});
	return facts.map(([by, fact], at) => ({
		pos: at + 1,
		ticket: 7,
		by,
		at: 1_762_000_000_000 + at * 1_000,
		fact,
	}));
})();

/** What the fold reads for that lane: its facts, its plan, its base, and the commits code made. */
const SEEN = Schema.decodeUnknownSync(Seen)({
	timeline: TIMELINE,
	plan: PLAN,
	base: BASE,
	commits: [
		{sha: EXAM_COMMIT, by: "test_writer", files: ["src/lower.test.ts"]},
		{sha: BUILT, by: "build", files: ["src/lower.ts"]},
	],
});

describe("what may restart", () => {
	// Round 4: the merge step ends `stuck:merged_elsewhere` when someone else merged the pull request,
	// so the lane stops on it now, and it is the plan's second final reason.
	it("FINAL is the closed list: merged_elsewhere and not_yours, each a reason this lane stops on", () => {
		const stuck: readonly string[] = LANE_NAMES.filter((name) => name.startsWith("stuck:"));
		const named = [...FINAL].map((why) => `stuck:${why}`);
		expect(named.filter((name) => stuck.includes(name)).sort()).toEqual([
			"stuck:merged_elsewhere",
			"stuck:not_yours",
		]);
		expect(named.length).toBe(2);
	});
});

describe("the fold of a lane's facts", () => {
	it("gives the carry the facts prove, misses nothing, and goes on at the step that stopped", () => {
		const folded = fold(SEEN);
		expect(folded.missing).toEqual([]);
		expect(folded.at).toEqual({_tag: "run", step: "mutation"});
		expect(folded.held).toMatchObject({count: 6, round: 1});
		expect(folded.held.carry).toMatchObject({
			plan: PLAN,
			version: 1,
			base: BASE,
			exam: ["src/lower.test.ts"],
			head: BUILT,
			checked: GREEN,
		});
	});

	it("with the plan's yes removed, it names `decided` and goes on by asking the plan's yes again", () => {
		const folded = fold({
			...SEEN,
			timeline: SEEN.timeline.filter((e) => e.fact.type !== "answered"),
		});
		expect(folded.missing).toContain("decided");
		expect(folded.at).toEqual({_tag: "ask", for: "approve", step: "plan"});
	});

	it("with the test writer's commit removed, it names `exam` and goes on at the test writer", () => {
		const folded = fold({...SEEN, commits: SEEN.commits.filter((c) => c.by !== "test_writer")});
		expect(folded.missing).toContain("exam");
		expect(folded.at).toEqual({_tag: "run", step: "test_writer"});
	});

	// Round 3 of the tests for self-fix PR 5: what the mutation step found no test held.
	const decodeEntry = Schema.decodeUnknownSync(Entry);

	it("with no working copy to read a base from, it names `base` and goes on at the test writer", () => {
		const folded = fold({...SEEN, base: null});
		expect(folded.missing).toContain("base");
		expect(folded.at).toEqual({_tag: "run", step: "test_writer"});
	});

	it("a second answer to a question already answered changes nothing: the first is the one the lane took", () => {
		const last = TIMELINE.at(-1);
		if (last === undefined) throw new Error("the timeline is empty");
		const late = decodeEntry({
			...last,
			pos: last.pos + 1,
			by: OWNER,
			fact: {type: "answered", ask: "a-approve-3", pick: "no", note: "On second thought, no."},
		});
		expect(fold({...SEEN, timeline: [...SEEN.timeline, late]})).toEqual(fold(SEEN));
	});

	it("a `go_on` the person gave lets through what the step could not test, as the lane did", () => {
		const ROW = {when: "a name has no letters", why: "no test can build such a name"};
		const writer = SEEN.timeline.findIndex(
			(e) => e.fact.type === "started" && e.fact.stage === "test_writer",
		);
		const more: readonly (readonly [unknown, Readonly<Record<string, unknown>>])[] = [
			[LANE, {type: "started", run: "r4", stage: "test_writer", task: null, log: null}],
			[
				LANE,
				{
					type: "ended",
					run: "r4",
					stage: "test_writer",
					outcome: {kind: "ask", who: "owner", for: "cannot_test"},
					usd: 0,
					input: 0,
					output: 0,
					turns: 1,
					carry: {cannot: [ROW]},
				},
			],
			[
				LANE,
				{
					type: "asked",
					ask: "a-step-9",
					what: "No test can check it.",
					picks: ["again", "go_on", "stop"],
				},
			],
			[OWNER, {type: "answered", ask: "a-step-9", pick: "go_on", note: ""}],
		];
		const timeline = [
			...SEEN.timeline.slice(0, writer),
			...more.map(([by, fact], i) =>
				decodeEntry({
					pos: writer + i + 1,
					ticket: 7,
					by,
					at: 1_762_000_000_000 + (writer + i) * 1_000,
					fact,
				}),
			),
		];
		const {carry} = fold({...SEEN, timeline}).held;
		expect(carry.untested).toEqual([ROW]);
		expect(carry.cannot ?? []).toEqual([]);
	});
});

describe("a lane saved before its stop kept a Held, sent `restart` with its fold", () => {
	type Msg = MsgOf<typeof lane>;
	const ID = make(LaneId)("L1");
	/** The stop as code from before this change saved it: no `Held`, and nowhere to go on. */
	const LEGACY = Schema.decodeUnknownSync(Lane)({
		phase: "over",
		number: 7,
		trail: [],
		outcome: {kind: "stuck", why: "step_stuck"},
		said: "mutation: stuck:run_failed",
	});

	/** Walk the restart, the ticket open and main as it was, up to the first step it runs or question it asks. */
	const goesOn = (folded: Folded) => {
		// An old save holds no lane id, and only the ledger mints one: the line names it.
		const queue: Msg[] = [{type: "restart", folded, lane: ID}];
		const sent: LaneCmd[] = [];
		let s: Lane = LEGACY;
		for (let i = 0; i < 20; i++) {
			const msg = queue.shift();
			if (msg === undefined) break;
			const {state, cmds} = foldUpdates<Lane, Msg, LaneCmd>(lane, s, [msg]);
			s = state;
			for (const cmd of cmds) {
				sent.push(cmd);
				if (cmd.type === "lane_step" || cmd.type === "lane_ask") return {s, sent, first: cmd};
				if (cmd.type === "lane_read") queue.push(readFiled.ok(cmd, {state: "open", mine: true}, 0));
				if (cmd.type === "lane_claim") queue.push(claimLane.ok(cmd, ID, 0));
				if (cmd.type === "lane_fresh") queue.push(freshMain.ok(cmd, {_tag: "fresh", carry: {}}, 0));
			}
		}
		return {s, sent, first: undefined};
	};

	it("with `decided` missing, it asks the plan's yes first: no triage, no plan", () => {
		const {s, first} = goesOn({
			held: {count: 2, round: 1, carry: {...EMPTY, plan: PLAN, version: 1}, trail: []},
			missing: ["decided"],
			at: {_tag: "ask", for: "approve", step: "plan"},
		});
		expect(first?.type).toBe("lane_ask");
		expect(s.phase === "asking" && s.question.for).toBe("approve");
	});

	it("with `exam` missing, it runs the test writer first: no triage, no plan, no yes", () => {
		const {first} = goesOn({
			held: {count: 3, round: 1, carry: {...EMPTY, plan: PLAN, version: 1, base: BASE}, trail: []},
			missing: ["exam"],
			at: {_tag: "run", step: "test_writer"},
		});
		expect(first?.type === "lane_step" && first.step).toBe("test_writer");
		expect(first?.type === "lane_step" && first.carry).toMatchObject({version: 1, base: BASE});
	});

	// The ledger keeps the plan's revision, not the draft the lane held: a revision has no properties,
	// interface or rule changes, which the steps after the plan read. A lane whose ends kept no carry
	// (written before this change) has no fact that proves its plan, so P4 holds: the fold names `plan`,
	// and the lane goes on at the step that writes it. Triage stays done.
	it("with no plan the facts prove, as the ledger has none for a lane from before this change, it names `plan` and runs the plan first: no triage", () => {
		const folded = fold({...SEEN, plan: null});
		expect(folded.missing).toContain("plan");
		expect(folded.at).toEqual({_tag: "run", step: "plan"});
		const {first} = goesOn(folded);
		expect(first?.type === "lane_step" && first.step).toBe("plan");
	});
});

// Self-fix PR 10: the exam's pull request is reviewed, then merged, before the test writer. The fold of
// a lane's facts gives the `Held` the lane saved at each point the new step can stop, and an exam
// head's own checks are never the lane's.
describe("the fold, with the exam's pull request", () => {
	const decodeEntry = Schema.decodeUnknownSync(Entry);
	const EXAM_PR = "local:example/lane/pull/1";
	const EXAM_HEAD = "3".repeat(40);
	const RULE = ".oxlintrc.json";
	const REVIEWED = {head: EXAM_HEAD, onto: "main", base: BASE, diff: "d".repeat(40), met: 1, of: 1};
	const EXAM_GREEN = {...GREEN, head: EXAM_HEAD, pr: EXAM_PR};
	const ASK_MERGE = "a-exam_merge-6";

	/** Ticket 7's facts up to the plan's yes, then `more`, each by the lane unless it says. */
	const timelineWith = (
		more: readonly (readonly [unknown, Readonly<Record<string, unknown>>])[],
	) => {
		const yes = TIMELINE.findIndex((e) => (e.fact as {type: string}).type === "answered");
		const head = TIMELINE.slice(0, yes + 1);
		return [
			...head,
			...more.map(([by, fact], i) => ({
				pos: head.length + i + 1,
				ticket: 7,
				by,
				at: 1_762_000_100_000 + i * 1_000,
				fact,
			})),
		].map((e) => decodeEntry(e));
	};
	const ran = (
		stage: string,
		run: string,
		outcome: unknown,
		carry: unknown,
		between: readonly Readonly<Record<string, unknown>>[] = [],
	): readonly (readonly [unknown, Readonly<Record<string, unknown>>])[] => [
		[LANE, {type: "started", run, stage, task: null, log: null}],
		...between.map((fact) => [LANE, fact] as const),
		[LANE, {type: "ended", run, stage, outcome, usd: 0, input: 0, output: 0, turns: 1, carry}],
	];
	const EXAM_END = ran(
		"exam",
		"r3",
		{kind: "ask", who: "owner", for: "check_change"},
		{rules: [RULE], examPr: EXAM_PR, examPull: {head: EXAM_HEAD}},
	);
	const REVIEW_END = ran(
		"exam_review",
		"r4",
		DONE,
		{examPull: {head: EXAM_HEAD, reviewed: REVIEWED}},
		[{type: "checked", ...EXAM_GREEN}],
	);
	const ASKED = [
		LANE,
		{
			type: "asked",
			ask: ASK_MERGE,
			what: "Do you want to merge these rule changes: .oxlintrc.json?",
			picks: ["merge", "no"],
			head: EXAM_HEAD,
		},
	] as const;
	const seenWith = (more: Parameters<typeof timelineWith>[0]) =>
		Schema.decodeUnknownSync(Seen)({...SEEN, timeline: timelineWith(more), commits: []});

	it("stopped at exam_review, goes on there, with the exam's pull request in its carry", () => {
		const folded = fold(
			seenWith([
				...EXAM_END,
				...ran("exam_review", "r4", {kind: "stuck", why: "run_failed"}, undefined),
			]),
		);
		expect(folded.at).toEqual({_tag: "run", step: "exam_review"});
		expect(folded.held.carry).toMatchObject({examPr: EXAM_PR, examPull: {head: EXAM_HEAD}});
	});

	it("stopped on the exam's merge question, asks it again, with the review the lane held", () => {
		const folded = fold(seenWith([...EXAM_END, ...REVIEW_END, ASKED]));
		expect(folded.at).toMatchObject({_tag: "ask", for: "exam_merge"});
		expect(folded.held.carry).toMatchObject({
			examPr: EXAM_PR,
			examPull: {head: EXAM_HEAD, reviewed: REVIEWED},
		});
		expect(folded.held.trail.map((row) => row.step)).toContain("exam_review");
	});

	it("an exam head's checks, with its pull request, are never the lane's own", () => {
		const folded = fold(
			seenWith([...EXAM_END, ...REVIEW_END, [LANE, {type: "checked", ...EXAM_GREEN}]]),
		);
		expect(folded.held.carry.head).not.toBe(EXAM_HEAD);
		expect(folded.held.carry.checked).toBeUndefined();
	});

	it("a person's merge at the exam head goes on at exam_merge, with their yes at that head", () => {
		const folded = fold(
			seenWith([
				...EXAM_END,
				...REVIEW_END,
				ASKED,
				[
					OWNER,
					{
						type: "answered",
						ask: ASK_MERGE,
						pick: "merge",
						note: "",
						head: EXAM_HEAD,
						onto: "main",
						base: BASE,
						diff: "d".repeat(40),
					},
				],
			]),
		);
		expect(folded.at).toEqual({_tag: "run", step: "exam_merge"});
		expect(folded.held.carry).toMatchObject({examPull: {head: EXAM_HEAD, yes: {head: EXAM_HEAD}}});
	});
});

// Self-fix PR 11b (docs/plan/pipeline-self-fix.md, PR 11, the record holes): a retry writes under its
// own run id, `r-<step>-<count>-<try>`, try 1 keeping today's id. The ticket keeps both ends, and the
// fold reads the last try's: the lane tried a step that could not run once more, as the same step.
describe("the fold, with a step tried again after it could not run", () => {
	const at = TIMELINE.findIndex((e) => e.fact.type === "started" && e.fact.stage === "build");
	const run = (fact: Readonly<Record<string, unknown>>, i: number) =>
		Schema.decodeUnknownSync(Entry)({
			pos: at + i + 1,
			ticket: 7,
			by: LANE,
			at: 1_762_000_000_000 + (at + i) * 1_000,
			fact,
		});
	const end = {stage: "build", usd: 0, input: 0, output: 0, turns: 1};
	const retried = [
		{type: "started", run: "r-build-5", stage: "build", task: null, log: null},
		{
			...end,
			type: "ended",
			run: "r-build-5",
			outcome: {kind: "stuck", why: "run_failed"},
			carry: {},
		},
		{type: "started", run: "r-build-5-2", stage: "build", task: null, log: null},
		{type: "checked", ...GREEN},
		{
			...end,
			type: "ended",
			run: "r-build-5-2",
			outcome: DONE,
			input: 41_000,
			carry: {head: BUILT, checked: GREEN},
		},
	].map(run);
	const seen = {...SEEN, timeline: [...SEEN.timeline.slice(0, at), ...retried]};

	it("keeps one row in the trail for the build, its last try's `done`, and goes on after it", () => {
		const folded = fold(seen);
		const {trail} = folded.held;
		expect(trail.filter((row) => row.step === "build")).toEqual([{step: "build", said: "done"}]);
		expect(trail.map((row) => row.said)).not.toContain("stuck:run_failed");
		expect(folded.missing).toEqual([]);
		expect(folded.at).toEqual({_tag: "run", step: "mutation"});
		expect(folded.held.carry).toMatchObject({head: BUILT, checked: GREEN});
	});

	// Round 2, the mutation step's gaps: a try's number and a run's count past 9, and a third try.
	const tries = (count: number, outcomes: readonly unknown[]) =>
		outcomes
			.flatMap((outcome, i) => {
				const id = runId("build", count, i + 1);
				return [
					{type: "started", run: id, stage: "build", task: null, log: null},
					{...end, type: "ended", run: id, outcome, carry: outcome === DONE ? {head: BUILT} : {}},
				];
			})
			.map(run);
	const broke = {kind: "stuck", why: "run_failed"};

	it("a run's first try is found under two-digit numbers too: r-build-12-2 and r-build-5-12", () => {
		expect(firstRun("r-build-12-2")).toBe("r-build-12");
		expect(firstRun("r-build-5-12")).toBe("r-build-5");
		expect(firstRun("r-build-12")).toBe("r-build-12");
		expect(firstRun("r-test_writer-10-3")).toBe("r-test_writer-10");
	});

	it("the next try of a step at a two-digit count counts that count's ends, and no other count's", () => {
		const timeline = [...tries(12, [broke, broke]), ...tries(1, [broke])];
		expect(nextAttempt(timeline, "build", 12)).toBe(3);
		expect(nextAttempt(timeline, "build", 1)).toBe(2);
		expect(nextAttempt(timeline, "build", 2)).toBe(1);
	});

	it("a build at count 12 tried again keeps one trail row, its last try's", () => {
		const folded = fold({
			...SEEN,
			timeline: [...SEEN.timeline.slice(0, at), ...tries(12, [broke, DONE])],
		});
		expect(folded.held.trail.filter((row) => row.step === "build")).toEqual([
			{step: "build", said: "done"},
		]);
	});

	it("a third try of a run that already has its row takes that same row: one row, the third try's", () => {
		const folded = fold({
			...SEEN,
			timeline: [...SEEN.timeline.slice(0, at), ...tries(5, [broke, broke, DONE])],
		});
		const {trail} = folded.held;
		expect(trail.filter((row) => row.step === "build")).toEqual([{step: "build", said: "done"}]);
		expect(trail.map((row) => row.said)).not.toContain("stuck:run_failed");
		expect(folded.at).toEqual({_tag: "run", step: "mutation"});
	});
});
