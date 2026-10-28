import {
	arbConstantMsg,
	arbMsg,
	arbRecordMsg,
	type MsgArbitraryTable,
	propertyInvariant,
	propertyTrace,
	type Step,
} from "@demlik/tea/pbt";
import type {MsgOf} from "@kampus/fabrika";
import {Schema} from "effect";
import * as fc from "fast-check";
import {describe, expect, it} from "vitest";
import {
	Mutation,
	type MutationCmd,
	mutation,
	outcomeOf,
	readScope,
	runMutants,
	runTests,
} from "./machine.ts";
import {changesOf, unapproved} from "./scope.ts";
import {ASK, HEAD, LIVED, SCOPE} from "./scripted.ts";
import type {Ran} from "./services.ts";

// The mutation step's laws, on tea's own property tests (`@demlik/tea/pbt`).
// Each folds a random list of Msgs through the real machine from its `init`
// and checks a law after every step. Each law is seen to fail on a planted
// mistake below.

type Machine = typeof mutation;
type Msg = MsgOf<Machine>;
type MutationStep = Step<Mutation, Msg, MutationCmd>;

const DISABLE = {
	file: "src/clamp.ts",
	line: 11,
	text: "// Stryker disable next-line all: no test can tell",
};
const EXAM = {...SCOPE.diff, files: [...SCOPE.diff.files, ...ASK.exam]};
/** A diff as it comes: clean, with a disable comment, touching the skip list, or with no source line. */
const scopes = fc.constantFrom(
	SCOPE,
	{...SCOPE, diff: {...SCOPE.diff, added: [...SCOPE.diff.added, DISABLE]}},
	{...SCOPE, diff: EXAM},
	{diff: {files: ["README.md"], added: []}, kept: []},
);
/** A run with none, one or two mutants that lived, each as often. */
const ran: fc.Arbitrary<Ran> = fc.integer({min: 0, max: 2}).map((n) => ({
	found: 5,
	ran: 5,
	skipped: 0,
	refused: 1,
	killed: 4 - n,
	lived: Array.from({length: n}, () => LIVED),
}));
/** A start that allows the disable comment, or allows nothing. */
const asks = fc.constantFrom(ASK, {...ASK, allowed: [{kind: "disable" as const, ...DISABLE}]});

const SCOPE_CMD = readScope({base: ASK.base, head: HEAD, kept: ASK.kept});
const TESTS_CMD = runTests({head: HEAD});
const RUN_CMD = runMutants({head: HEAD, spans: [], seed: ASK.seed, most: ASK.most});
const NOT_RUN = {_tag: "could_not_run" as const};

/** One entry per Msg type: leaving one out does not compile. */
const table: MsgArbitraryTable<Msg> = {
	start: arbRecordMsg("start", {ask: asks}),
	resume: arbConstantMsg("resume"),
	mutation_scope_ok: scopes.map((s) => readScope.ok(SCOPE_CMD, s, 0)),
	mutation_scope_err: fc.constant(readScope.err(SCOPE_CMD, {_tag: "unknown"}, 0)),
	mutation_tests_ok: fc
		.constantFrom("green" as const, "red" as const)
		.map((r) => runTests.ok(TESTS_CMD, r, 0)),
	mutation_tests_err: fc.constant(runTests.err(TESTS_CMD, NOT_RUN, 0)),
	mutation_run_ok: ran.map((r) => runMutants.ok(RUN_CMD, r, 0)),
	mutation_run_err: fc.constant(runMutants.err(RUN_CMD, NOT_RUN, 0)),
};
/** A start first, most of the time, then any Msgs: a run's answers, late ones, restarts and failures. */
const lists = fc
	.tuple(
		fc.option(table.start, {freq: 8}),
		fc.array(
			arbMsg(table, {
				weights: {start: 2, mutation_scope_ok: 4, mutation_tests_ok: 4, mutation_run_ok: 4},
			}),
			{maxLength: 12, size: "max"},
		),
	)
	.map(([first, rest]) => (first === null ? rest : [first, ...rest]));
const RUNS = {numRuns: 400, seed: 49};

/** The law, as a step's answer: `null` holds, a sentence is how it broke. */
type Law = (step: MutationStep) => string | null;
type TraceLaw = (steps: readonly MutationStep[]) => string | null;

const each = (law: Law) => (step: MutationStep) => law(step) === null;
const whole = (law: TraceLaw) => (steps: readonly MutationStep[]) => law(steps) === null;

/** An over state is for good: it changes on no Msg and sends nothing. */
const overForGood: Law = ({prev, next, cmds}) =>
	prev.phase === "over" && (next !== prev || cmds.length > 0) ? "an over state moved" : null;

/** It ends `done` only when Stryker ran and nothing lived, and every mutant that lives is sent on. */
const nothingLivesQuietly: Law = ({prev, next}) => {
	if (prev.phase === "over" || next.phase !== "over") return null;
	const {outcome, report} = next;
	const lived = report.ran?.lived.length ?? 0;
	if (outcome.kind === "done" && (report.ran === null || lived > 0))
		return "done without a clean run";
	if (lived > 0 && outcome.kind !== "send") return "a mutant lived and was not sent on";
	if (outcome.kind === "send" && lived === 0) return "sent with no mutant";
	return null;
};

/** Stryker runs only on green from the repo's own tests, or again after a restart that found it in flight. */
const testsFirst: Law = ({prev, msg, cmds}) => {
	if (!cmds.some((c) => c.type === "mutation_run")) return null;
	if (msg.type === "mutation_tests_ok" && msg.value === "green") return null;
	if (msg.type === "resume" && prev.phase === "mutating") return null;
	return `Stryker started on ${msg.type}`;
};

/** A change to the exam the owner did not allow never reaches a run: the last diff read had none. */
const examIsTheOwners: TraceLaw = (steps) => {
	let open = false;
	for (const {prev, msg, cmds} of steps) {
		if (msg.type === "mutation_scope_ok" && prev.phase === "reading")
			open = unapproved(changesOf(msg.value.diff, prev.ask.exam), prev.ask.allowed).length > 0;
		if (open && cmds.some((c) => c.type === "mutation_tests" || c.type === "mutation_run"))
			return "ran with a change the owner did not allow";
	}
	return null;
};

const encode = Schema.encodeSync(Mutation);
const decode = Schema.decodeUnknownSync(Mutation);
/** Every state saves and loads back equal, so a restart reads what it left. */
const kept: Law = ({next}) =>
	JSON.stringify(decode(encode(next))) === JSON.stringify(next) ? null : "lost on save";

const checkEach = (machine: Machine, law: Law) =>
	propertyInvariant(machine, undefined, lists, each(law), RUNS);
const checkWhole = (machine: Machine, law: TraceLaw) =>
	propertyTrace(machine, undefined, lists, whole(law), RUNS);

describe("the mutation step's laws", () => {
	it("hold on the real machine", () => {
		for (const law of [overForGood, nothingLivesQuietly, testsFirst, kept])
			checkEach(mutation, law);
		checkWhole(mutation, examIsTheOwners);
	});
});

describe("each law is seen to fail on a planted mistake", () => {
	const plant = (update: Partial<Machine["update"]>): Machine => ({
		...mutation,
		update: {...mutation.update, ...update},
	});

	it("an over state that starts again", () => {
		const restarts = plant({
			start: (s, m) =>
				s.phase === "over"
					? [{ask: m.ask, phase: "reading", asked: SCOPE_CMD}, [SCOPE_CMD]]
					: mutation.update.start(s, m),
		});
		expect(() => checkEach(restarts, overForGood)).toThrow();
	});

	it("a run with a mutant that lived, taken as done", () => {
		const quiet = plant({
			mutation_run_ok: (s, m) =>
				s.phase === "mutating"
					? [
							{
								ask: s.ask,
								phase: "over",
								outcome: {kind: "done", part: false},
								report: {changes: [], spans: s.spans, ran: m.value},
							},
							[],
						]
					: [s, []],
		});
		expect(() => checkEach(quiet, nothingLivesQuietly)).toThrow();
		expect(
			outcomeOf({found: 1, ran: 1, skipped: 0, refused: 0, killed: 0, lived: [LIVED]}).kind,
		).toBe("send");
	});

	it("Stryker started on red tests", () => {
		const onRed = plant({
			mutation_tests_ok: (s, m) =>
				s.phase === "testing"
					? mutation.update.mutation_tests_ok(s, {...m, value: "green"})
					: [s, []],
		});
		expect(() => checkEach(onRed, testsFirst)).toThrow();
	});

	it("a disable comment the owner did not allow, run anyway", () => {
		const ignores = plant({
			mutation_scope_ok: (s, m) =>
				s.phase === "reading"
					? mutation.update.mutation_scope_ok(
							{...s, ask: {...s.ask, exam: [], allowed: []}},
							{
								...m,
								value: {
									...m.value,
									diff: {
										...m.value.diff,
										added: m.value.diff.added.filter((a) => !a.text.includes("Stryker")),
									},
								},
							},
						)
					: [s, []],
		});
		expect(() => checkWhole(ignores, examIsTheOwners)).toThrow();
	});

	it("a state its schema cannot keep", () => {
		// Lines counted from 0, as Stryker's instrumenter counts them: a span from line 0 does not save.
		const leaks = plant({
			mutation_scope_ok: (s, m) => {
				const [next, cmds] = mutation.update.mutation_scope_ok(s, m);
				if (next.phase !== "testing") return [next, cmds];
				return [{...next, spans: next.spans.map((x) => ({...x, from: x.from - 9}))}, cmds];
			},
		});
		expect(() => checkEach(leaks, kept)).toThrow();
	});
});
