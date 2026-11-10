import {describe, expect, expectTypeOf, it} from "vitest";
import {BUILD_NAMES, type BuildName} from "../build/outcome.ts";
import {EXAM_NAMES, type ExamOutcome} from "../exam/machine.ts";
import {MUTATION_NAMES, type MutationName} from "../mutation/outcome.ts";
import type {Name} from "../outcome.ts";
import {PLAN_NAMES, type PlanName} from "../plan/outcome.ts";
import {PUSH_NAMES, type PushOutcome} from "../push/machine.ts";
import {REVIEW_NAMES, type ReviewName} from "../review/outcome.ts";
import {SHIP_NAMES, type ShipName} from "../ship/outcome.ts";
import {SORT_NAMES, type SortName} from "../sort/outcome.ts";
import {MUTANTS_NAMES, type MutantsOutcome} from "../test-writer/mutants.ts";
import {TEST_WRITER_NAMES, type TestWriterName} from "../test-writer/outcome.ts";
import {type LaneStep, STEPS} from "./machine.ts";
import {
	back,
	EXAM_MERGE_SENDS,
	fresh,
	type Move,
	once,
	ROUTES,
	type Routes,
	run,
} from "./routes.ts";

// Today's version. A ship refusal at `exam_merge` goes to the step that can fix it, never to
// `stuck:sent_back` (self-fix PR 10, Part 3). The rows are typed over ship's own names, so a send with
// no route does not compile; this law reads them at run time, so a row deleted behind a cast is
// caught too. These are the first rows of PR 11's `ROUTES`, in its `Move` shape.

/** Every `send` ship can end with, read off ship's own union: a new one joins by being there. */
const SHIP_SENDS = SHIP_NAMES.filter((name) => name.startsWith("send:"));

/** What breaks the law in a table of rows: a ship send with no row. */
const unrouted = (table: Readonly<Record<string, Move | undefined>>): readonly string[] =>
	SHIP_SENDS.filter((name) => table[name] === undefined);

describe("the exam_merge rows", () => {
	it("are the plan's: code first for what code can fix, the exam writer for what it must rewrite", () => {
		expect(EXAM_MERGE_SENDS).toEqual({
			"send:reviewer:no_review": run("exam_review"),
			"send:builder:checks_red": run("exam_review"),
			"send:builder:behind": fresh("exam_review"),
			"send:builder:review_failed": back("exam", "findings"),
			"send:builder:conflicts": back("exam", "files"),
			"send:builder:bot_comment": back("exam", "comment"),
			"send:builder:ejected": once,
		});
	});

	it("route every send ship can end with", () => {
		expect(SHIP_SENDS.length).toBeGreaterThan(0);
		expect(unrouted(EXAM_MERGE_SENDS)).toEqual([]);
	});

	it("that law catches its plant: the bot_comment row deleted behind a cast", () => {
		const planted: Record<string, Move | undefined> = {...EXAM_MERGE_SENDS};
		delete planted["send:builder:bot_comment"];
		expect(unrouted(planted)).toEqual(["send:builder:bot_comment"]);
	});

	it("never ask a person: each send at exam_merge is fixable (193's classes)", () => {
		for (const move of Object.values(EXAM_MERGE_SENDS))
			expect(JSON.stringify(move)).not.toMatch(/ask|stuck/);
	});
});

// Self-fix PR 11a: every outcome has a route (docs/plan/pipeline-self-fix.md, PR 11). `ROUTES[step][name]`
// has one row per name `step` can hand the lane: its stage's names, and the ones the lane's own step
// bodies make in program.ts. A step with no row for a name, or a row for a name it cannot say, does not
// compile (jidoka row 9: a send with no route is preventable). Red today: there is no `ROUTES`, no
// `Routes`, and exam, push and the mutants job export only a schema, so nothing types the table.

/** The names the lane's step bodies make in program.ts, on top of their stage's (experiment 193's `MADE`). */
type MadeAtBuild =
	| "send:builder:checks_red" // program.ts:711
	| "stuck:checks_not_run" // program.ts:678, :718
	| "stuck:rounds_spent" // program.ts:686
	| "ask:owner:no_change" // program.ts:684, a call whose `after` is done
	| "ask:owner:still_red"; // program.ts:689

type MadeAtExamReview =
	| "stuck:head_moved" // program.ts:872
	| "send:builder:conflicts" // program.ts:877
	| "stuck:checks_not_run" // program.ts:888
	| "send:builder:checks_red"; // program.ts:894

type MadeAtReview = "ask:owner:unseen" | "ask:owner:decision"; // program.ts:1327, :1345
type MadeAtMerge = "stuck:merged_elsewhere"; // program.ts:1412

/** Every name each step can hand the lane, as the plan's `NamesAt`. */
const NAMES_AT: Readonly<Record<LaneStep, readonly string[]>> = {
	triage: SORT_NAMES,
	plan: PLAN_NAMES,
	exam: EXAM_NAMES,
	exam_review: REVIEW_NAMES,
	exam_merge: SHIP_NAMES,
	test_writer: TEST_WRITER_NAMES,
	build: BUILD_NAMES,
	mutation: MUTATION_NAMES,
	mutants: MUTANTS_NAMES,
	review: REVIEW_NAMES,
	push: PUSH_NAMES,
	merge: SHIP_NAMES,
};

describe("ROUTES, typed over every name each step can say (self-fix PR 11a)", () => {
	it("has one row per name for every step: its keys are the stage's names and the lane's own", () => {
		expectTypeOf<keyof (typeof ROUTES)["triage"]>().toEqualTypeOf<SortName>();
		expectTypeOf<keyof (typeof ROUTES)["plan"]>().toEqualTypeOf<PlanName | "stuck:unchecked">();
		expectTypeOf<keyof (typeof ROUTES)["exam"]>().toEqualTypeOf<Name<ExamOutcome>>();
		expectTypeOf<keyof (typeof ROUTES)["exam_review"]>().toEqualTypeOf<
			ReviewName | MadeAtExamReview
		>();
		expectTypeOf<keyof (typeof ROUTES)["exam_merge"]>().toEqualTypeOf<ShipName>();
		expectTypeOf<keyof (typeof ROUTES)["test_writer"]>().toEqualTypeOf<TestWriterName>();
		expectTypeOf<keyof (typeof ROUTES)["build"]>().toEqualTypeOf<BuildName | MadeAtBuild>();
		expectTypeOf<keyof (typeof ROUTES)["mutation"]>().toEqualTypeOf<MutationName>();
		expectTypeOf<keyof (typeof ROUTES)["mutants"]>().toEqualTypeOf<Name<MutantsOutcome>>();
		expectTypeOf<keyof (typeof ROUTES)["review"]>().toEqualTypeOf<ReviewName | MadeAtReview>();
		expectTypeOf<keyof (typeof ROUTES)["push"]>().toEqualTypeOf<Name<PushOutcome>>();
		expectTypeOf<keyof (typeof ROUTES)["merge"]>().toEqualTypeOf<ShipName | MadeAtMerge>();
		expectTypeOf<keyof typeof ROUTES>().toEqualTypeOf<LaneStep>();
	});

	it("does not compile with a row deleted, or with a row for a name ship cannot say", () => {
		const {"send:reviewer:no_review": dropped, ...missing} = ROUTES.merge;
		// @ts-expect-error `merge` with no row for `send:reviewer:no_review`, a name ship can say.
		const noRow: Routes["merge"] = missing;
		const extraRow: Routes["merge"] = {
			...ROUTES.merge,
			// @ts-expect-error `send:builder:not_ship` is no name ship can say.
			"send:builder:not_ship": dropped,
		};
		expect([noRow, extraRow].length).toBe(2);
	});

	it("routes every name each stage exports, at run time too, so a row deleted behind a cast is caught", () => {
		const table: Readonly<Record<string, Readonly<Record<string, Move | undefined>>>> = ROUTES;
		const unrouted = STEPS.flatMap((step) =>
			NAMES_AT[step]
				.filter((name) => table[step]?.[name] === undefined)
				.map((name) => `${step} ${name}`),
		);
		expect(unrouted).toEqual([]);
	});

	it("exam, push and the mutants job export their names, as the other stages do", () => {
		expect([...EXAM_NAMES].sort()).toEqual(
			[
				"done",
				"done:part",
				"ask:owner:check_change",
				"skip:no_rules_change",
				"stuck:draft_failed",
				"stuck:unchecked",
				"stuck:land_failed",
			].sort(),
		);
		expect([...PUSH_NAMES].sort()).toEqual(
			["done", "done:part", "stuck:push_failed", "stuck:open_failed", "stuck:post_failed"].sort(),
		);
		expect([...MUTANTS_NAMES].sort()).toEqual(
			["done", "done:part", "ask:owner:disable", "stuck:not_killed", "stuck:run_failed"].sort(),
		);
	});
});
