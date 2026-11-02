// Experiment 193: every way today's lane stops or needs a person, from the code. See 193-lane-holes.md.
//
//   env -u TYPESAFE_API_KEY -u OPENAI_API_KEY -u CODEX_API_KEY \
//     nice -n 15 node experiments/193-lane-holes.ts
//
// Today's version only (`packages/pipeline`, not `next/`). No model, no key, no network, $0.
//
// It drives the real `lane` reducer (packages/pipeline/src/stages/pipeline/machine.ts), not a copy of
// its rules:
//
//   1. For each step, every outcome its stage can say: the names each stage's `outcomesOf` makes (or
//      its exported schema, for exam, push and the mutants job), plus the outcomes the lane's own step
//      bodies make in program.ts (listed by hand in `MADE`, with file:line, since no list exports them).
//      Each is sent as `lane_step_ok` to a `running` state, at round 1, at the last round, and with
//      `[build] send_back = false`. The row says where the lane went: a step, an ask, a stop or an end.
//   2. Every ask a row reached, and every pick its real question offers: `lane_answered`, and where
//      that went.
//   3. The lane's other doors: a step that cannot run twice, a question that cannot be written, the
//      read, the claim, a restart's fresh read of main with each of its six answers, and the guard on
//      a step after build whose head has no green checks.
//
// Each row that ends at a stop or a person gets a class, by hand, in `CLASS` below:
//
//   needed       only a person can decide
//   fixable      a step the lane already has could fix it, with no judgment
//   dead_end     a stop with no way on but a restart, though a step exists that should take it
//   unreachable  cannot happen, with why
//
// A row the table does not name prints as `unclassed`, so a new outcome cannot pass unsaid. It writes
// experiments/results/193-lane-holes.json and prints the counts.

import {readdirSync, readFileSync, writeFileSync} from "node:fs";
import {join} from "node:path";
import {make} from "@kampus/pipeline/entity";
import {LaneId} from "@kampus/pipeline/ids";
import {BUILD_NAMES} from "@kampus/pipeline/stages/build/outcome";
import {ExamOutcome} from "@kampus/pipeline/stages/exam/machine";
import {MUTATION_NAMES} from "@kampus/pipeline/stages/mutation/outcome";
import {nameOf, partsOf} from "@kampus/pipeline/stages/outcome";
import {
	afterBuild,
	askPerson,
	type Carry,
	claimLane,
	EMPTY,
	freshMain,
	type Held,
	type Lane,
	type LaneStep,
	lane,
	MAX_ROUNDS,
	PICKS,
	readFiled,
	type Resume,
	runStep,
	STEPS,
} from "@kampus/pipeline/stages/pipeline/machine";
import {isEnd} from "@kampus/pipeline/stages/pipeline/outcome";
import {PLAN_NAMES} from "@kampus/pipeline/stages/plan/outcome";
import {PushOutcome} from "@kampus/pipeline/stages/push/machine";
import {REVIEW_NAMES} from "@kampus/pipeline/stages/review/outcome";
import {SHIP_NAMES} from "@kampus/pipeline/stages/ship/outcome";
import {SORT_NAMES} from "@kampus/pipeline/stages/sort/outcome";
import {MutantsOutcome} from "@kampus/pipeline/stages/test-writer/mutants";
import {TEST_WRITER_NAMES} from "@kampus/pipeline/stages/test-writer/outcome";

const OUT = "experiments/results/193-lane-holes.json";
const SRC = "packages/pipeline/src";

// ---------------------------------------------------------------------------------------------
// Every outcome each step can hand the lane.

/** The names an exported outcome schema allows: for the stages whose `outcomesOf` list is not exported. */
const namesOfSchema = (schema: unknown): readonly string[] => {
	const members = (schema as {members: readonly {fields: Record<string, any>}[]}).members;
	return members.flatMap(({fields}) => {
		const kind: string = fields.kind.literal;
		if (kind === "done") return ["done", "done:part"];
		if (kind === "send")
			return (fields.why.literals as string[]).map((w) => `send:${fields.to.literal}:${w}`);
		if (kind === "ask")
			return (fields.for.literals as string[]).map((f) => `ask:${fields.who.literal}:${f}`);
		return (fields.why.literals as string[]).map((w) => `${kind}:${w}`);
	});
};

/** Which stage machine each lane step runs, by program.ts's `bodies` (program.ts:710-1260). */
const STAGE_OF: Readonly<
	Record<
		LaneStep,
		{readonly stage: string; readonly names: readonly string[]; readonly dir: string}
	>
> = {
	triage: {stage: "sort", names: SORT_NAMES, dir: "stages/sort"},
	plan: {stage: "plan", names: PLAN_NAMES, dir: "stages/plan"},
	exam: {stage: "exam", names: namesOfSchema(ExamOutcome), dir: "stages/exam"},
	exam_merge: {stage: "ship", names: SHIP_NAMES, dir: "stages/ship"},
	test_writer: {stage: "test-writer", names: TEST_WRITER_NAMES, dir: "stages/test-writer"},
	build: {stage: "build", names: BUILD_NAMES, dir: "stages/build"},
	mutation: {stage: "mutation", names: MUTATION_NAMES, dir: "stages/mutation"},
	mutants: {
		stage: "test-writer (mutants job)",
		names: namesOfSchema(MutantsOutcome),
		dir: "stages/test-writer",
	},
	review: {stage: "review", names: REVIEW_NAMES, dir: "stages/review"},
	push: {stage: "push", names: namesOfSchema(PushOutcome), dir: "stages/push"},
	merge: {stage: "ship", names: SHIP_NAMES, dir: "stages/ship"},
};

/**
 * The outcomes a lane step body makes itself, on top of or in place of its stage's. By hand: program.ts
 * builds them inline. `after`: the end a person's `go_on` takes (a call). `replaces`: a stage name
 * the body turns into this one, so the stage's own never reaches the lane.
 */
const MADE: readonly {
	readonly step: LaneStep;
	readonly name: string;
	readonly at: string;
	readonly after?: string;
	readonly replaces?: string;
}[] = [
	{step: "plan", name: "stuck:unchecked", at: "pipeline/program.ts:757"},
	{step: "build", name: "send:builder:checks_red", at: "pipeline/program.ts:688"},
	{step: "build", name: "stuck:checks_not_run", at: "pipeline/program.ts:655, 695"},
	{step: "build", name: "stuck:rounds_spent", at: "pipeline/program.ts:663"},
	{step: "build", name: "ask:owner:no_change", at: "pipeline/program.ts:661", after: "done"},
	{step: "build", name: "ask:owner:still_red", at: "pipeline/program.ts:666"},
	{
		step: "review",
		name: "ask:owner:unseen",
		at: "pipeline/program.ts:1171",
		replaces: "stuck:unseen",
	},
	{step: "review", name: "ask:owner:decision", at: "pipeline/program.ts:1188", after: "done"},
	{step: "merge", name: "stuck:merged_elsewhere", at: "pipeline/program.ts:1256"},
];

/** Where in a stage's files a word is first written as a value, for the row's file:line. */
const sources = new Map<
	string,
	readonly {readonly file: string; readonly lines: readonly string[]}[]
>();
const filesOf = (dir: string) => {
	const had = sources.get(dir);
	if (had !== undefined) return had;
	const files = readdirSync(join(SRC, dir))
		.filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
		.map((f) => ({
			file: `${dir.replace("stages/", "")}/${f}`,
			lines: readFileSync(join(SRC, dir, f), "utf8").split("\n"),
		}));
	sources.set(dir, files);
	return files;
};
const whereOf = (dir: string, name: string): string => {
	const {verb, why} = partsOf(name);
	if (verb === "done") return `${dir.replace("stages/", "")}/outcome.ts`;
	const word = `"${why}"`;
	const files = filesOf(dir);
	// An emitting line first, then the declaration in a list.
	const emits = (line: string) =>
		line.includes(word) && /why: |for: |stuckOutcome\(|stuck\(|over\(|end\(/.test(line);
	for (const pick of [emits, (line: string) => line.includes(word)])
		for (const {file, lines} of [...files].sort(
			(a, b) => Number(a.file.endsWith("outcome.ts")) - Number(b.file.endsWith("outcome.ts")),
		))
			for (const [i, line] of lines.entries()) if (pick(line)) return `${file}:${i + 1}`;
	return "not found";
};

/** An outcome value from its name, as `factOutcome` (program.ts:191) would hand it to the lane. */
const outcomeOf = (name: string) => {
	const {verb, who, why} = partsOf(name);
	switch (verb) {
		case "done":
			return {kind: "done", part: why === "part"} as const;
		case "send":
			return {kind: "send", to: who ?? "", why: why ?? ""} as const;
		case "ask":
			return {kind: "ask", who: who ?? "", for: why ?? ""} as const;
		default:
			return {kind: verb, why: why ?? ""} as const;
	}
};

// ---------------------------------------------------------------------------------------------
// States to drive the reducer from.

const ID = make(LaneId)("L1");
const BASE = "base0";
const HEAD = "head1";
const GREEN = {head: HEAD, commands: [], result: "green", failed: []} as const;
/** A carry a lane far along holds: a base, a head with green checks, both pull requests. */
const CARRY: Carry = {
	...EMPTY,
	version: 1,
	base: BASE,
	head: HEAD,
	checked: GREEN,
	examPr: "pr/exam",
	pr: "pr/lane",
	rules: [".oxlintrc.json"],
};

const heldAt = (round: number, sendBack?: boolean): Held => ({
	number: 7,
	lane: ID,
	...(sendBack === undefined ? {} : {sendBack}),
	count: 5,
	round,
	carry: CARRY,
	trail: [],
});

const running = (step: LaneStep, round: number, sendBack?: boolean): Lane => {
	const held = heldAt(round, sendBack);
	const asked = runStep({
		number: 7,
		count: held.count,
		step,
		round,
		carry: held.carry,
		intent: `lane/7/5/${step}`,
	});
	return {...held, phase: "running", step, asked} as Lane;
};

type Dest =
	| {readonly go: "run"; readonly step: string; readonly round: number}
	| {
			readonly go: "ask";
			readonly for: string;
			readonly step: string;
			readonly picks: readonly string[];
			readonly call?: string;
	  }
	| {
			readonly go: "stop" | "end";
			readonly outcome: string;
			readonly at?: string;
			readonly said: string;
	  };

const atWords = (at: Resume | undefined): string | undefined =>
	at === undefined
		? undefined
		: at._tag === "run"
			? `run ${at.step}${at.round === "next" ? " (next round)" : ""}`
			: `ask ${at.for} (${at.step})`;

const destOf = (s: Lane): Dest => {
	switch (s.phase) {
		case "running":
			return {go: "run", step: s.step, round: s.round};
		case "asking":
			return {
				go: "ask",
				for: s.question.for,
				step: s.question.step,
				picks: s.question.picks,
				...(s.question.call === undefined
					? {}
					: {call: `${s.question.call.about} -> ${nameOf(s.question.call.after)}`}),
			};
		case "releasing":
		case "over": {
			const outcome = "outcome" in s ? s.outcome : undefined;
			if (outcome === undefined) throw new Error(`no outcome in ${s.phase}`);
			const at = "at" in s ? (s.at as Resume) : undefined;
			return {
				go: isEnd(outcome) ? "end" : "stop",
				outcome: nameOf(outcome),
				...(at === undefined ? {} : {at: atWords(at)}),
				said: s.said,
			};
		}
		default:
			return {go: "stop", outcome: `phase ${s.phase}`, said: ""};
	}
};

const words = (d: Dest): string =>
	d.go === "run"
		? `run ${d.step} r${d.round}`
		: d.go === "ask"
			? `ask ${d.for} (${d.step}) [${d.picks.join("/")}]${d.call === undefined ? "" : ` call ${d.call}`}`
			: `${d.go} ${d.outcome}${d.at === undefined ? "" : ` at ${d.at}`}`;

const stepEnd = (
	step: LaneStep,
	name: string,
	round: number,
	sendBack?: boolean,
	after?: string,
	carry: Partial<Carry> = {},
) => {
	const s = running(step, round, sendBack);
	if (s.phase !== "running") throw new Error("not running");
	const value = {
		outcome: outcomeOf(name),
		carry,
		...(after === undefined ? {} : {after: outcomeOf(after)}),
	};
	const [next] = lane.update.lane_step_ok(s, runStep.ok(s.asked, value as never, 0));
	return next;
};

// ---------------------------------------------------------------------------------------------
// The classes, by hand. Keyed `step name` for a step's outcome, `ask <for> <pick>` for a pick, and
// `door <what>` for the lane's other doors. `cover`: which self-fix PR (1 to 10) already takes it, or
// the jidoka table row (docs/direction/jidoka-and-andon.md) that names it as later work, or `new`.

type Class = "needed" | "fixable" | "dead_end" | "unreachable";
interface Classed {
	readonly class: Class;
	readonly why: string;
	readonly owner?: string;
	readonly cover: string;
}

const C = (cls: Class, why: string, cover: string, owner?: string): Classed => ({
	class: cls,
	why,
	cover,
	...(owner === undefined ? {} : {owner}),
});

const CLASS: Readonly<Record<string, Classed>> = {
	// triage
	"triage ask:owner:ruling": C("needed", "worth is a person's call", "table 15"),
	"triage stuck:read_failed": C(
		"fixable",
		"a read that broke: wait and read again",
		"table 16",
		"the Tickets service",
	),
	"triage stuck:write_failed": C(
		"fixable",
		"a keyed write: wait and write again",
		"table 16",
		"the Tickets service",
	),
	"triage stuck:draft_failed": C(
		"fixable",
		"the sorter broke: run once more",
		"table 17",
		"triage",
	),
	"triage stuck:unchecked": C("needed", "drafts spent; a person reads why", "table 17"),
	"triage stuck:over_budget": C("needed", "a spend ask", "table 18"),
	"triage stuck:changed": C("fixable", "sort again on the new words", "table 19", "triage"),
	"triage skip:closed": C("unreachable", "an end, not a hole: the ticket is closed", "none needed"),
	"triage done": C("unreachable", "an end, not a hole: triage closed the ticket", "none needed"),
	"triage done:part": C("unreachable", "sort's done never has part", "none needed"),
	// plan
	"plan stuck:read_failed": C("fixable", "wait and read again", "table 21", "the Tickets service"),
	"plan stuck:draft_failed": C("fixable", "the planner broke: run once more", "table 22", "plan"),
	"plan stuck:cut_off": C(
		"fixable",
		"a restart cut it off twice: run once more",
		"table 22",
		"plan",
	),
	"plan stuck:unchecked": C(
		"needed",
		"drafts spent; or the lane's own Check and form disagree (program.ts:757), a fault in code",
		"table 22, 24",
	),
	"plan stuck:over_budget": C("needed", "a spend ask", "table 23"),
	"plan skip:closed": C("unreachable", "an end, not a hole", "none needed"),
	"plan done:part": C("unreachable", "the plan's done never has part", "none needed"),
	// exam
	"exam stuck:draft_failed": C("fixable", "run once more", "table 26", "exam"),
	"exam stuck:unchecked": C("needed", "drafts spent", "table 26"),
	"exam stuck:land_failed": C(
		"fixable",
		"a keyed write: the open finds its own pull request again (github.ts:173)",
		"table 27",
		"exam",
	),
	"exam done": C(
		"unreachable",
		"the exam machine never says done: it skips or asks (exam/machine.ts:236, 246)",
		"none needed",
	),
	"exam done:part": C("unreachable", "as done", "none needed"),
	// exam_merge: ship on the exam's own pull request
	"exam_merge send:builder:review_failed": C(
		"unreachable",
		"the exam pull request's one review is a stand-in that always passes, and its one criterion is a person's yes (pulls.ts:212, 430)",
		"none needed",
	),
	"exam_merge send:builder:checks_red": C(
		"fixable",
		"known holes 1 and 2: format the exam's files, then the exam step redoes them; today a stop",
		"PR 10 (known)",
		"exam",
	),
	"exam_merge send:builder:conflicts": C(
		"fixable",
		"known hole 2: main moved under the exam branch; the exam step lands its files again on main",
		"PR 10 (known, if it routes every send)",
		"exam",
	),
	"exam_merge send:builder:ejected": C(
		"fixable",
		"known hole 2: thrown out of the queue; read why, ship again",
		"PR 10 (known, if it routes every send)",
		"exam_merge",
	),
	"exam_merge send:builder:bot_comment": C(
		"fixable",
		"known hole 2: any bot comment on the exam pull request stops the lane",
		"PR 10 (known, if it routes every send)",
		"exam",
	),
	"exam_merge send:builder:behind": C(
		"fixable",
		"known hole 2: take main in, run the checks, ship again, with no agent",
		"PR 10 (known, if it routes every send)",
		"exam_merge",
	),
	"exam_merge send:reviewer:no_review": C(
		"fixable",
		"known hole 3: the stand-in review counts only at the head the lane pushed (github.ts:49); any other commit makes it missing for good. Ask the person again at the new head",
		"PR 10 (known)",
		"exam_merge",
	),
	"exam_merge ask:owner:approval": C(
		"needed",
		"a person's approval on protected files",
		"table 60",
	),
	"exam_merge ask:commenter:comment": C("needed", "a person's open comment", "table 61"),
	"exam_merge skip:closed": C(
		"dead_end",
		"a closed exam pull request stops the lane stuck:step_stuck; the exam step could open it again, or the ticket ends",
		"table 13 (for ship)",
		"exam",
	),
	"exam_merge skip:draft": C("dead_end", "as closed", "table 13 (for ship)", "exam"),
	"exam_merge skip:not_ours": C(
		"unreachable",
		"the lane opened it on the person's login",
		"none needed",
	),
	"exam_merge stuck:criteria_unknown": C(
		"unreachable",
		"the lane's record gives the exam ticket one criterion, a person's yes (pulls.ts:430)",
		"none needed",
	),
	"exam_merge stuck:proof_refused": C(
		"fixable",
		"read fresh, once per head",
		"table 66",
		"exam_merge",
	),
	"exam_merge stuck:read_failed": C(
		"fixable",
		"wait and read again",
		"table 64",
		"the code host service",
	),
	"exam_merge stuck:enqueue_failed": C(
		"fixable",
		"read the pull request fresh: merged is a fact",
		"table 68",
		"exam_merge",
	),
	"exam_merge stuck:merge_failed": C("fixable", "read fresh", "table 68", "exam_merge"),
	"exam_merge stuck:head_moving": C(
		"fixable",
		"read fresh, once per head",
		"table 66",
		"exam_merge",
	),
	"exam_merge stuck:checks_stuck": C("fixable", "wait once more", "table 67", "exam_merge"),
	"exam_merge stuck:queue_silent": C("fixable", "wait once more", "table 67", "exam_merge"),
	"exam_merge stuck:merge_unknown": C("fixable", "read fresh", "table 68", "exam_merge"),
	"exam_merge stuck:approval_unknown": C(
		"fixable",
		"wait and read again",
		"table 64",
		"the code host service",
	),
	"exam_merge stuck:reviews_unknown": C(
		"fixable",
		"wait and read again",
		"table 64",
		"the code host service",
	),
	// test writer
	"test_writer ask:owner:fails_on_base": C(
		"needed",
		"a test of today's code fails: maybe a bug on main; the table leans one more writer try first",
		"table 28",
	),
	"test_writer ask:owner:already_passes": C(
		"fixable",
		"back to the writer once, then ask",
		"table 29",
		"test_writer",
	),
	"test_writer ask:owner:cannot_test": C(
		"needed",
		"a person lets a property through untested",
		"table 30",
	),
	"test_writer stuck:read_failed": C(
		"fixable",
		"wait and read again",
		"table 32",
		"the work service",
	),
	"test_writer stuck:commit_failed": C("fixable", "local: once more", "table 32", "test_writer"),
	"test_writer stuck:record_failed": C(
		"fixable",
		"a keyed write: wait",
		"table 32",
		"the Tickets service",
	),
	"test_writer stuck:draft_failed": C(
		"fixable",
		"once more, in its own session",
		"table 33",
		"test_writer",
	),
	"test_writer stuck:cut_off": C("fixable", "once more", "table 33", "test_writer"),
	"test_writer stuck:unchecked": C("needed", "drafts spent", "table 33"),
	"test_writer stuck:run_failed": C(
		"fixable",
		"run once more, output kept",
		"table 34",
		"test_writer",
	),
	"test_writer stuck:no_result": C(
		"fixable",
		"back to the writer with the test the run did not report",
		"table 35",
		"test_writer",
	),
	"test_writer done:part": C("unreachable", "the writer's done never has part", "none needed"),
	// build
	"build stuck:read_failed": C("fixable", "wait and read again", "table 37", "the Tickets service"),
	"build stuck:copy_failed": C("fixable", "local: once more", "table 37", "build"),
	"build stuck:push_failed": C(
		"unreachable",
		"the lane's build never pushes: push is its own step (program.ts:1195)",
		"none needed",
	),
	"build stuck:open_failed": C(
		"unreachable",
		"as push_failed: the lane's build opens nothing",
		"none needed",
	),
	"build stuck:no_criteria": C(
		"unreachable",
		"in the lane the plan's Properties are the criteria, and the plan's Check needs one; not proven by a law",
		"table 38",
	),
	"build stuck:criteria_unknown": C(
		"unreachable",
		"as no_criteria; not proven by a law",
		"table 38",
	),
	"build stuck:draft_failed": C(
		"fixable",
		"once more, from the working copy as it stands",
		"table 39",
		"build",
	),
	"build stuck:over_budget": C("needed", "a spend ask", "table 40"),
	"build stuck:no_change": C(
		"fixable",
		"first round changed nothing: once more, told so, then ask",
		"table 41",
		"build",
	),
	"build stuck:checks_not_run": C(
		"needed",
		"the checks could not run even once more: a person looks at why. A restart runs them at mutation (machine.ts:84)",
		"PR 4",
	),
	"build ask:owner:no_change": C(
		"needed",
		"the builder says the work stands; the table leans a fresh review first",
		"table 45",
	),
	"build ask:owner:still_red": C(
		"fixable",
		"another round with the failing names, until the rounds are spent",
		"table 46",
		"build",
	),
	"build stuck:rounds_spent": C("needed", "the rounds' question", "PR 3"),
	"build skip:closed": C(
		"dead_end",
		"a ticket closed mid-run stops the lane stuck:step_stuck; it should end skip:closed",
		"table 13",
		"the lane",
	),
	"build skip:merged": C(
		"dead_end",
		"a merged change stops stuck:step_stuck; it should read the host and end done or merged_elsewhere",
		"table 13",
		"the lane",
	),
	"build skip:not_ready": C(
		"unreachable",
		"the lane's yes writes the approval first; not proven by a law",
		"table 14",
	),
	"build done:part": C("unreachable", "the build's done never has part", "none needed"),
	"build stuck:exam_touched": C("needed", "which was wrong, the builder or the test", "PR 5"),
	// mutation
	"mutation ask:owner:check_change": C(
		"needed",
		"a disable comment or an ignorer change is the person's exam",
		"table 48 (preventable)",
	),
	"mutation stuck:read_failed": C("fixable", "wait and read again", "table 49", "the work service"),
	"mutation stuck:run_failed": C("fixable", "run once more, output kept", "table 51", "mutation"),
	"mutation done:part": C("unreachable", "never part", "none needed"),
	// mutants
	"mutants ask:owner:disable": C("needed", "a disable comment needs the person", "table 31"),
	"mutants stuck:not_killed": C(
		"fixable",
		"a new test missed its mutant: back to the writer once with which",
		"new",
		"mutants",
	),
	"mutants stuck:run_failed": C("fixable", "run once more", "new", "mutants"),
	"mutants done:part": C("unreachable", "never part", "none needed"),
	// review
	"review ask:owner:unseen": C(
		"needed",
		"the reviewer could not see a criterion: a person can",
		"table 52",
	),
	"review ask:owner:decision": C("needed", "a finding against the person's decision", "table 53"),
	"review stuck:unseen": C(
		"unreachable",
		"the lane turns it into ask:owner:unseen (program.ts:1170)",
		"none needed",
	),
	"review send:builder:no_ticket": C(
		"dead_end",
		"routed to the test writer and build as a round, but no writer can add a ticket name; the lane's review reads its own book target, so likely unreachable, not proven",
		"new",
		"review",
	),
	"review stuck:read_failed": C(
		"fixable",
		"wait and read again",
		"table 54",
		"the review pack service",
	),
	"review stuck:ticket_unknown": C(
		"fixable",
		"wait and read again",
		"table 54",
		"the review pack service",
	),
	"review stuck:diff_unknown": C(
		"fixable",
		"wait and read again",
		"table 54",
		"the review pack service",
	),
	"review stuck:kinds_unknown": C(
		"fixable",
		"wait and read again",
		"table 54",
		"the review pack service",
	),
	"review stuck:checks_unknown": C(
		"fixable",
		"wait and read again",
		"table 54",
		"the review pack service",
	),
	"review stuck:no_criteria": C(
		"unreachable",
		"checked at the plan's Check; not proven by a law",
		"table 55",
	),
	"review stuck:rubric_unknown": C(
		"fixable",
		"a missing rubrics folder: check it when the lane starts, before any agent",
		"table 55",
		"the lane, at start",
	),
	"review stuck:draft_failed": C("fixable", "once more, in its own session", "table 56", "review"),
	"review stuck:over_budget": C("needed", "a spend ask", "table 57"),
	"review stuck:checks_stuck": C("fixable", "wait once more", "table 58", "review"),
	"review skip:merged": C(
		"dead_end",
		"stops stuck:step_stuck; should read the host and end",
		"table 13",
		"the lane",
	),
	"review skip:closed": C(
		"dead_end",
		"stops stuck:step_stuck; should end skip:closed",
		"table 13",
		"the lane",
	),
	"review skip:draft": C(
		"unreachable",
		"the lane's review target is its own book, never a draft",
		"table 13",
	),
	"review done:part": C(
		"unreachable",
		"part is a kind of review this stage does not do; the lane goes on to push as on done",
		"none needed",
	),
	// push
	"push stuck:push_failed": C(
		"fixable",
		"keyed: wait and push again",
		"table 59",
		"the work service",
	),
	"push stuck:open_failed": C(
		"fixable",
		"keyed: the open finds its own pull request (github.ts:173)",
		"table 59",
		"push",
	),
	"push stuck:post_failed": C(
		"fixable",
		"keyed: a verdict with the same marker is not posted twice (operate/writes.ts:63)",
		"table 59",
		"push",
	),
	"push done:part": C("unreachable", "never part", "none needed"),
	// merge: ship on the lane's pull request
	"merge send:builder:review_failed": C(
		"fixable",
		"to build, next round, with the finding",
		"table 62",
		"build",
	),
	"merge send:builder:checks_red": C(
		"fixable",
		"to build, next round, with the names",
		"table 62",
		"build",
	),
	"merge send:builder:conflicts": C(
		"fixable",
		"code takes main in; a conflict in the builder's files goes to build",
		"table 62",
		"build",
	),
	"merge send:builder:ejected": C("fixable", "to build, next round", "table 62", "build"),
	"merge send:builder:bot_comment": C(
		"fixable",
		"to build, next round, with the comment",
		"table 62",
		"build",
	),
	"merge send:builder:behind": C(
		"fixable",
		"code takes main in and runs the checks: no agent, no round",
		"table 62",
		"merge",
	),
	"merge send:reviewer:no_review": C(
		"fixable",
		"to review again, at the new head",
		"table 63",
		"review",
	),
	"merge ask:owner:approval": C("needed", "approval on protected files", "table 60"),
	"merge ask:commenter:comment": C("needed", "a person's open comment", "table 61"),
	"merge skip:closed": C(
		"dead_end",
		"a closed pull request stops stuck:step_stuck",
		"table 13",
		"the lane",
	),
	"merge skip:draft": C("dead_end", "a draft stops stuck:step_stuck", "table 13", "the lane"),
	"merge skip:not_ours": C("unreachable", "the lane opened it", "table 13"),
	"merge stuck:criteria_unknown": C(
		"unreachable",
		"the lane's pull request names its ticket; not proven by a law",
		"table 65",
	),
	"merge stuck:proof_refused": C("fixable", "read fresh, once per head", "table 66", "merge"),
	"merge stuck:read_failed": C(
		"fixable",
		"wait and read again",
		"table 64",
		"the code host service",
	),
	"merge stuck:enqueue_failed": C("fixable", "read fresh: merged is a fact", "table 68", "merge"),
	"merge stuck:merge_failed": C("fixable", "read fresh", "table 68", "merge"),
	"merge stuck:head_moving": C("fixable", "read fresh, once per head", "table 66", "merge"),
	"merge stuck:checks_stuck": C("fixable", "wait once more", "table 67", "merge"),
	"merge stuck:queue_silent": C("fixable", "wait once more", "table 67", "merge"),
	"merge stuck:merge_unknown": C("fixable", "read fresh", "table 68", "merge"),
	"merge stuck:approval_unknown": C(
		"fixable",
		"wait and read again",
		"table 64",
		"the code host service",
	),
	"merge stuck:reviews_unknown": C(
		"fixable",
		"wait and read again",
		"table 64",
		"the code host service",
	),
	"merge stuck:merged_elsewhere": C("needed", "someone else merged it", "table 69"),
	// asks and their picks
	"ask approve approve": C("needed", "the plan's yes", "table 10"),
	"ask approve no": C("needed", "a pause; the same line plans again", "PR 5"),
	"ask exam_merge merge": C("needed", "the rule changes' yes", "table 11"),
	"ask exam_merge no": C("needed", "a pause; asks again", "PR 5"),
	"ask merge merge": C("needed", "the merge yes", "table 12"),
	"ask merge no": C("needed", "a pause; asks again", "PR 5"),
	"ask step stop": C("needed", "a pause at that step", "PR 5"),
	"ask rounds_spent stop": C("needed", "a pause on the rounds", "PR 3, 5"),
	"ask exam_conflict stop": C("needed", "a pause; asks again", "PR 5"),
	// doors
	"door read: ticket could not be read": C(
		"fixable",
		"wait and read again",
		"table 2",
		"the Tickets service",
	),
	"door read: not filed by you": C("needed", "whose ticket runs on your login", "table 1"),
	"door read: closed": C("unreachable", "an end, not a hole", "none needed"),
	"door claim: could not be made": C(
		"fixable",
		"a keyed write: wait",
		"table 4",
		"the ledger service",
	),
	"door claim: another lane holds it": C(
		"fixable",
		"this lane's own saved id takes its claim back; another's is skip:claimed",
		"table 3",
		"the lane",
	),
	"door restart claim: could not be made": C(
		"fixable",
		"a keyed write: wait",
		"table 4",
		"the ledger service",
	),
	"door restart claim: another lane holds it": C("fixable", "as the claim", "table 3", "the lane"),
	"door step: could not run twice": C(
		"needed",
		"`once` is spent: a person reads why. But the cause goes only to the tile, not the ticket (program.ts:1513)",
		"PR 5",
	),
	"door ask: question could not be written": C(
		"fixable",
		"its id makes a second write safe: write it again",
		"table 6",
		"the Tickets service",
	),
	"door fresh: main could not be read": C(
		"fixable",
		"wait and read again",
		"new",
		"the work service",
	),
	"door fresh: closed": C("unreachable", "an end, not a hole", "none needed"),
	"door fresh: not_yours": C("needed", "a FINAL stop", "table 1"),
	"door guard: no green checks at the head": C(
		"dead_end",
		"the mutants job commits tests and its checks do not run: review stops. A restart runs them (program.ts:1371), so the lane could run them here",
		"new",
		"build checks",
	),
	"door guard: red checks at the head": C(
		"dead_end",
		"the mutants job's new tests turn the checks red: review stops stuck:checks_red. A restart sends it to build a round up (machine.ts:1266), so the lane could do that here",
		"new",
		"build",
	),
};

// ---------------------------------------------------------------------------------------------
// 1. Every (step, outcome).

interface Row {
	readonly key: string;
	readonly step: LaneStep;
	readonly name: string;
	readonly stage: string;
	readonly source: string;
	readonly r1: string;
	readonly atBound?: string;
	readonly sendBackOff?: string;
	readonly dest: Dest;
	readonly classed: Classed | "unclassed" | null;
}

const rows: Row[] = [];
const asks = new Map<string, Lane>();
const classOf = (key: string, dest: Dest): Classed | "unclassed" | null => {
	if (dest.go === "run") return null;
	// An end with nothing left to do, and a person's ask whose own row classes it: only stops and ends are classed here.
	if (dest.go === "ask") return CLASS[key] ?? null;
	if (dest.go === "end" && (dest.outcome === "done" || dest.outcome.startsWith("skip:")))
		return CLASS[key] ?? null;
	return CLASS[key] ?? "unclassed";
};

for (const step of STEPS) {
	const {stage, names, dir} = STAGE_OF[step];
	const made = MADE.filter((m) => m.step === step);
	const replaced = new Set(made.flatMap((m) => (m.replaces === undefined ? [] : [m.replaces])));
	const all = [
		...names
			.filter((n) => !made.some((m) => m.name === n))
			.map((name) => ({name, at: whereOf(dir, name), after: undefined as string | undefined})),
		...made.map((m) => ({name: m.name, at: m.at, after: m.after})),
	];
	for (const {name, at, after} of all) {
		const key = `${step} ${name}`;
		const r1s = stepEnd(step, name, 1, undefined, after);
		const dest = destOf(r1s);
		const bound = words(destOf(stepEnd(step, name, MAX_ROUNDS, undefined, after)));
		const off = words(destOf(stepEnd(step, name, 1, false, after)));
		const r1 = words(dest);
		if (r1s.phase === "asking")
			asks.set(`${r1s.question.for} ${r1s.question.step} ${r1s.question.call?.about ?? ""}`, r1s);
		const classed = replaced.has(name) ? (CLASS[key] ?? "unclassed") : classOf(key, dest);
		rows.push({
			key,
			step,
			name,
			stage,
			source: replaced.has(name) ? `${at} (replaced by the lane)` : at,
			r1,
			...(bound === r1 ? {} : {atBound: bound}),
			...(off === r1 ? {} : {sendBackOff: off}),
			dest,
			classed,
		});
		// The ask at the bound is a different question: keep it too.
		const b = stepEnd(step, name, MAX_ROUNDS, undefined, after);
		if (b.phase === "asking")
			asks.set(`${b.question.for} ${b.question.step} ${b.question.call?.about ?? ""}`, b);
	}
}

// ---------------------------------------------------------------------------------------------
// 2. Every pick of every ask the rows reached, plus the restart's own ask (exam_conflict, below).

interface PickRow {
	readonly key: string;
	readonly ask: string;
	readonly pick: string;
	readonly to: string;
	readonly classed: Classed | null;
}

// 3. The lane's other doors.
interface Door {
	readonly key: string;
	readonly to: string;
	readonly classed: Classed | "unclassed" | null;
}
const doors: Door[] = [];
const door = (what: string, s: Lane) => {
	const key = `door ${what}`;
	const dest = destOf(s);
	doors.push({
		key,
		to: words(dest),
		classed: dest.go === "run" ? null : (CLASS[key] ?? "unclassed"),
	});
	if (s.phase === "asking")
		asks.set(`${s.question.for} ${s.question.step} ${s.question.call?.about ?? ""}`, s);
};

const READ = readFiled({number: 7});
const reading = {phase: "reading", number: 7, lane: ID, asked: READ} as Lane;
door(
	"read: ticket could not be read",
	lane.update.lane_read_err(reading, readFiled.err(READ, {_tag: "unknown"}, 0))[0],
);
door(
	"read: not filed by you",
	lane.update.lane_read_ok(reading, readFiled.ok(READ, {state: "open", mine: false}, 0))[0],
);
door(
	"read: closed",
	lane.update.lane_read_ok(reading, readFiled.ok(READ, {state: "closed", mine: true}, 0))[0],
);

const CLAIM = claimLane({number: 7, lane: ID, intent: "c"});
const claiming = {...heldAt(1), carry: EMPTY, phase: "claiming", asked: CLAIM} as Lane;
door(
	"claim: could not be made",
	lane.update.lane_claim_err(claiming, claimLane.err(CLAIM, {_tag: "unknown"}, 0))[0],
);
door(
	"claim: another lane holds it",
	lane.update.lane_claim_ok(claiming, claimLane.ok(CLAIM, make(LaneId)("L2"), 0))[0],
);
const restarting = {
	...heldAt(1),
	at: {_tag: "run", step: "mutation"},
	phase: "restarting",
	asked: CLAIM,
} as Lane;
door(
	"restart claim: could not be made",
	lane.update.lane_claim_err(restarting, claimLane.err(CLAIM, {_tag: "unknown"}, 0))[0],
);
door(
	"restart claim: another lane holds it",
	lane.update.lane_claim_ok(restarting, claimLane.ok(CLAIM, make(LaneId)("L2"), 0))[0],
);

const stepFailures: {readonly step: LaneStep; readonly first: string; readonly second: string}[] =
	[];
for (const step of STEPS) {
	const s = running(step, 1);
	if (s.phase !== "running") continue;
	const [once] = lane.update.lane_step_err(s, runStep.err(s.asked, {_tag: "unknown"}, 0));
	const [twice] = lane.update.lane_step_err(once, runStep.err(s.asked, {_tag: "unknown"}, 0));
	stepFailures.push({
		step,
		first: once.phase === "running" ? `run ${step} again (same Act)` : words(destOf(once)),
		second: words(destOf(twice)),
	});
	if (step === "build") door("step: could not run twice", twice);
}

const FRESH_TAGS = [
	{_tag: "fresh", carry: {}},
	{_tag: "merged", carry: {}},
	{_tag: "exam_conflict", files: ["a.test.ts"], carry: {touched: ["a.test.ts"]}},
	{_tag: "conflicts", files: ["src/a.ts"], carry: {}},
	{_tag: "closed"},
	{_tag: "not_yours"},
] as const;
const freshRows: {
	readonly from: LaneStep;
	readonly found: string;
	readonly to: string;
	readonly redTo?: string;
}[] = [];
for (const step of STEPS) {
	const at: Resume = {_tag: "run", step};
	const held = heldAt(1);
	const asked = freshMain({number: 7, from: at, carry: held.carry, intent: "f"});
	const refreshing = {...held, at, phase: "refreshing", asked} as Lane;
	for (const found of FRESH_TAGS) {
		const [next] = lane.update.lane_fresh_ok(refreshing, freshMain.ok(asked, found as never, 0));
		const red =
			found._tag === "fresh" && afterBuild(step)
				? words(
						destOf(
							lane.update.lane_fresh_ok(
								refreshing,
								freshMain.ok(
									asked,
									{_tag: "fresh", carry: {checked: {...GREEN, result: "red"}}} as never,
									0,
								),
							)[0],
						),
					)
				: undefined;
		freshRows.push({
			from: step,
			found: found._tag,
			to: words(destOf(next)),
			...(red === undefined ? {} : {redTo: red}),
		});
		if (step === "mutation") {
			if (found._tag === "closed") door("fresh: closed", next);
			if (found._tag === "not_yours") door("fresh: not_yours", next);
		}
		if (next.phase === "asking")
			asks.set(
				`${next.question.for} ${next.question.step} ${next.question.call?.about ?? ""}`,
				next,
			);
	}
	if (step === "mutation")
		door(
			"fresh: main could not be read",
			lane.update.lane_fresh_err(refreshing, freshMain.err(asked, {_tag: "unknown"}, 0))[0],
		);
}

// The guard in `running` (machine.ts:926): the mutants job's done into review, its new commit's checks
// not run, then red. The mutants job records checks at its new head (program.ts:1080); build never says
// done on red (program.ts:688).
{
	const {checked: _, ...none} = CARRY;
	const s = running("mutants", 1);
	if (s.phase === "running") {
		const done = {kind: "done", part: false};
		const noChecks = {...s, carry: none} as Lane;
		if (noChecks.phase === "running")
			door(
				"guard: no green checks at the head",
				lane.update.lane_step_ok(
					noChecks,
					runStep.ok(noChecks.asked, {outcome: done, carry: {}} as never, 0),
				)[0],
			);
		door(
			"guard: red checks at the head",
			lane.update.lane_step_ok(
				s,
				runStep.ok(
					s.asked,
					{outcome: done, carry: {checked: {...GREEN, result: "red"}}} as never,
					0,
				),
			)[0],
		);
	}
}

// Picks, now every ask is known.
const picks: PickRow[] = [];
const askFailures: Door[] = [];
for (const [sig, s] of asks) {
	if (s.phase !== "asking") continue;
	const q = s.question;
	for (const pick of q.picks) {
		const [next] = lane.update.lane_answered(s, {
			type: "lane_answered",
			ask: q.ask,
			pick,
			note: "",
		});
		const dest = destOf(next);
		const key = `ask ${q.for} ${pick}`;
		picks.push({
			key,
			ask: sig.trim(),
			pick,
			to: words(dest),
			classed: dest.go === "run" ? null : (CLASS[key] ?? null),
		});
	}
	const ASK = askPerson({number: 7, ask: q.ask, what: q.what, picks: q.picks, intent: "a"});
	const [failed] = lane.update.lane_ask_err(s, askPerson.err(ASK, {_tag: "unknown"}, 0));
	askFailures.push({key: `ask_err ${sig.trim()}`, to: words(destOf(failed)), classed: null});
}
door(
	"ask: question could not be written",
	(() => {
		const first = [...asks.values()][0];
		if (first === undefined || first.phase !== "asking") throw new Error("no ask");
		const ASK = askPerson({number: 7, ask: first.question.ask, what: "", picks: [], intent: "a"});
		return lane.update.lane_ask_err(first, askPerson.err(ASK, {_tag: "unknown"}, 0))[0];
	})(),
);

// ---------------------------------------------------------------------------------------------
// Counts and the table.

const persons = rows.filter((r) => r.dest.go === "ask");
const stops = rows.filter(
	(r) => r.dest.go === "stop" || (r.dest.go === "end" && r.dest.outcome.startsWith("stuck:")),
);
const classedAll = [
	...rows.map((r) => ({key: r.key, c: r.classed})),
	...doors.map((d) => ({key: d.key, c: d.classed})),
	...picks.map((p) => ({key: p.key, c: p.classed})),
].filter((x) => x.c !== null);
const firsts = new Map<string, (typeof classedAll)[number]>();
for (const x of classedAll) if (!firsts.has(x.key)) firsts.set(x.key, x);
const seen = new Set(firsts.keys());
const unique = [...firsts.values()];
const byClass: Record<string, number> = {};
for (const {c} of unique) {
	const k = c === "unclassed" ? "unclassed" : (c as Classed).class;
	byClass[k] = (byClass[k] ?? 0) + 1;
}
const holes = unique.filter(
	(x) =>
		x.c !== "unclassed" &&
		x.c !== null &&
		((x.c as Classed).class === "fixable" || (x.c as Classed).class === "dead_end"),
);
const newHoles = holes.filter((x) => (x.c as Classed).cover === "new");
/** The rows of the jidoka table the self-fix plan builds (docs/plan/pipeline-self-fix.md, PRs 1 to 9). */
const BUILT = new Set([5, 8, 10, 11, 12, 36, 42, 43, 44, 46, 47, 50]);
const coverOf = ({cover}: Classed): "a PR in 1 to 10" | "a later ticket" | "new" => {
	if (cover === "new") return "new";
	if (cover.startsWith("PR")) return "a PR in 1 to 10";
	const nums = [...cover.matchAll(/\d+/g)].map((m) => Number(m[0]));
	return nums.some((n) => BUILT.has(n)) ? "a PR in 1 to 10" : "a later ticket";
};
const holesBy: Record<string, number> = {};
for (const {c} of holes) {
	const k = coverOf(c as Classed);
	holesBy[k] = (holesBy[k] ?? 0) + 1;
}
/**
 * A note the table keeps on a row that goes on to a step, so it is not a stop and not counted. A key
 * here that names no row at all is a typo: `rows` and `picks` list every key there is.
 */
const known = new Set([
	...rows.map((r) => r.key),
	...picks.map((p) => p.key),
	...doors.map((d) => d.key),
]);
const goesOn = Object.keys(CLASS).filter((k) => !seen.has(k));
const typos = goesOn.filter((k) => !known.has(k));
if (typos.length > 0) throw new Error(`classes for rows that do not exist: ${typos.join(", ")}`);
const unclassed = unique.filter((x) => x.c === "unclassed").map((x) => x.key);

const PICKS_IN_CODE = Object.fromEntries(Object.entries(PICKS).map(([k, v]) => [k, [...v]]));
const summary = {
	version: "today's (packages/pipeline)",
	steps: STEPS.length,
	pairs: rows.length,
	toAPerson: persons.length,
	toAStop: stops.length,
	asks: asks.size,
	picks: picks.length,
	doors: doors.length,
	classed: byClass,
	holes: holes.length,
	holesBy,
	newHoles: newHoles.map((x) => x.key),
	unclassed,
	notedButGoesOn: goesOn,
};

writeFileSync(
	OUT,
	`${JSON.stringify({summary, picksInCode: PICKS_IN_CODE, rows, picks, doors, stepFailures, askFailures, freshRows}, null, 1)}\n`,
);
console.log(JSON.stringify(summary, null, 1));
for (const r of rows) {
	const c =
		r.classed === null
			? ""
			: r.classed === "unclassed"
				? "  UNCLASSED"
				: `  [${r.classed.class}; ${r.classed.cover}]`;
	console.log(
		`${r.key.padEnd(44)} -> ${r.r1}${r.atBound === undefined ? "" : ` | at bound: ${r.atBound}`}${r.sendBackOff === undefined ? "" : ` | send_back off: ${r.sendBackOff}`}${c}`,
	);
}
for (const p of picks) console.log(`pick ${p.ask} :: ${p.pick} -> ${p.to}`);
for (const d of doors) console.log(`${d.key} -> ${d.to}`);
for (const f of freshRows)
	console.log(
		`fresh from ${f.from} ${f.found} -> ${f.to}${f.redTo === undefined ? "" : ` | red: ${f.redTo}`}`,
	);
