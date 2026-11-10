import {defineMachine} from "@demlik/tea";
import {Schema} from "effect";
import {checkRun, gather, keptCmd} from "../../primitives.ts";
import {Checked} from "../../tickets/ticket.ts";
import {MutationOutcome} from "./outcome.ts";
import {Change, CodeRef, changesOf, Scope, Span, spansOf, unapproved} from "./scope.ts";
import {Ran, RunAsk, Tested} from "./services.ts";

// The mutation step (docs/direction/promises-in-the-pipeline.md, step 5):
// after the build, before review. No agent sits inside it; code does it all.
//
//   reading    the diff from the plan's base to the build's head, where
//              each kept Property's code stands, and a hash of each file of
//              the exam at the head. A Gather
//              Then two pure Checks (./scope.ts): a change to the exam asks
//              the owner, and no line to mutate is a skip
//   testing    the repo's own tests at the head, first: a mutant is graded on
//              what they miss, so they must pass. A red head goes back to the
//              builder, each failing test by name. A Check that runs code.
//              Skipped when code's own checks were green at this very head
//              just before (`checked`): the report then names them as trusted
//   mutating   StrykerJS over those lines, a fixed-seed sample of at most
//              `most`, the ignorer's mutants left out, each mutant that
//              survives typechecked and counted only if the typecheck takes
//              it. A Check that runs code
//   over       the outcome, and the report it was worked out from
//
// Every mutant that survives blocks the pull request and goes to the test
// writer's mutants job (`send:test_writer:mutant_survived`), whether a
// Property is about its line or not. The machine writes nothing.

const Unknown = ["unknown"] as const;

/** One run, as asked. `allowed`: the changes to the exam with the owner's approval. `most`: the sample's size. */
export const MutationAsk = Schema.Struct({
	ticket: Schema.String,
	base: Schema.String,
	head: Schema.String,
	/** The code of each kept Property: its lines are mutated too. */
	kept: Schema.Array(CodeRef),
	/** The files that are part of the exam, such as the ignorer. A diff that touches one asks the owner. */
	exam: Schema.Array(Schema.String),
	allowed: Schema.Array(Change),
	seed: Schema.Int,
	most: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
	/** Code's own checks at the head, as the lane ran them after the build. Left out: none ran. */
	checked: Schema.optionalKey(Checked),
});
export type MutationAsk = typeof MutationAsk.Type;

/** About 150 mutants at most, as experiments 121 and 139 sampled. */
export const MAX_MUTANTS = 150;

const ScopeIn = Schema.Struct({
	base: Schema.String,
	head: Schema.String,
	kept: Schema.Array(CodeRef),
	exam: Schema.Array(Schema.String),
});

const TestsIn = Schema.Struct({head: Schema.String});

export const readScope = gather("mutation_scope", {input: ScopeIn, ok: Scope, err: Unknown});
export const runTests = checkRun("mutation_tests", {input: TestsIn, verdict: Tested});
export const runMutants = checkRun("mutation_run", {input: RunAsk, verdict: Ran});

type ScopeCmd = ReturnType<typeof readScope>;
type TestsCmd = ReturnType<typeof runTests>;
type RunCmd = ReturnType<typeof runMutants>;
export type MutationCmd = ScopeCmd | TestsCmd | RunCmd;

/** What a run leaves besides its outcome. */
export const MutationReport = Schema.Struct({
	/** The changes to the exam the owner is asked about, each quoted. */
	changes: Schema.Array(Change),
	/** The lines it mutated. */
	spans: Schema.Array(Span),
	/** What Stryker found. `null`: it did not run. */
	ran: Schema.NullOr(Ran),
	/**
	 * Each test that failed at the head, by name: what the builder is sent back with. Every run
	 * writes it. Optional: a state saved before this key still reads.
	 */
	failed: Schema.optionalKey(Schema.Array(Schema.String)),
	/** On a red head: the first lines of why, for the ticket. The error text exists only now. */
	tail: Schema.optionalKey(Schema.String),
	/**
	 * The green checks at the head it trusted in place of its own run of the repo's tests, so a skip
	 * never reads as a clean run. Left out: it ran them, or Stryker never ran.
	 */
	trusted: Schema.optionalKey(Checked),
});
export type MutationReport = typeof MutationReport.Type;

const Held = Schema.Struct({ask: MutationAsk});
type Held = typeof Held.Type;
const Scoped = Schema.Struct({...Held.fields, spans: Schema.Array(Span)});
type Scoped = typeof Scoped.Type;

/** The mutation step's state, and the schema it is kept and read back through. */
export const Mutation = Schema.Union([
	Schema.Struct({phase: Schema.Literal("idle")}),
	Schema.Struct({
		...Held.fields,
		phase: Schema.Literal("reading"),
		asked: keptCmd(readScope, ScopeIn),
	}),
	Schema.Struct({
		...Scoped.fields,
		phase: Schema.Literal("testing"),
		asked: keptCmd(runTests, TestsIn),
	}),
	Schema.Struct({
		...Scoped.fields,
		phase: Schema.Literal("mutating"),
		asked: keptCmd(runMutants, RunAsk),
	}),
	Schema.Struct({
		...Held.fields,
		phase: Schema.Literal("over"),
		outcome: MutationOutcome,
		report: MutationReport,
	}),
]);
export type Mutation = typeof Mutation.Type;

export type MutationMsg =
	| {readonly type: "start"; readonly ask: MutationAsk}
	/** Sent once after booting from saved state: re-issue whatever was in flight. */
	| {readonly type: "resume"};

type Step = readonly [Mutation, readonly MutationCmd[]];
const stay = (s: Mutation): Step => [s, []];
const scoped = (s: Scoped): Scoped => ({ask: s.ask, spans: s.spans});

const blank: MutationReport = {changes: [], spans: [], ran: null, failed: []};

const end = (s: Held, outcome: MutationOutcome, report: Partial<MutationReport> = {}): Step => [
	{ask: s.ask, phase: "over", outcome, report: {...blank, ...report}},
	[],
];

/** Code's checks at the ask's own head, when they were green: the one case the tests are skipped on. Pure. */
const greenAt = (ask: MutationAsk): Checked | null =>
	ask.checked !== undefined && ask.checked.result === "green" && ask.checked.head === ask.head
		? ask.checked
		: null;

/** What a report says of a skipped run of the tests: the checks it trusted. Pure. */
const trusting = (ask: MutationAsk): Partial<MutationReport> => {
	const trusted = greenAt(ask);
	return trusted === null ? {} : {trusted};
};

/** The outcome of a run that came back: every mutant killed, or each one that survived goes to the writer. */
export const outcomeOf = (ran: Ran): MutationOutcome =>
	ran.survived.length === 0
		? {kind: "done", part: false}
		: {kind: "send", to: "test_writer", why: "mutant_survived"};

export const mutation = defineMachine({
	types: {
		model: {} as Mutation,
		msg: {} as MutationMsg,
		ctx: undefined,
	},
	cmds: [readScope, runTests, runMutants],
	init: (loaded) => [loaded ?? {phase: "idle"}, []],
	update: {
		start: (s, m): Step => {
			if (s.phase !== "idle") return stay(s);
			const {base, head, kept, exam} = m.ask;
			const asked = readScope({base, head, kept, exam});
			return [{ask: m.ask, phase: "reading", asked}, [asked]];
		},
		resume: (s): Step =>
			s.phase === "reading" || s.phase === "testing" || s.phase === "mutating"
				? [s, [s.asked]]
				: stay(s),

		mutation_scope_ok: (s, m): Step => {
			if (s.phase !== "reading") return stay(s);
			const spans = spansOf(m.value);
			const changes = unapproved(changesOf(m.value, s.ask.exam), s.ask.allowed);
			if (changes.length > 0)
				return end(s, {kind: "ask", who: "owner", for: "check_change"}, {changes, spans});
			if (spans.length === 0) return end(s, {kind: "skip", why: "no_lines"});
			if (greenAt(s.ask) !== null) {
				const {head, seed, most} = s.ask;
				const asked = runMutants({head, spans, seed, most});
				return [{ask: s.ask, spans, phase: "mutating", asked}, [asked]];
			}
			const asked = runTests({head: s.ask.head});
			return [{ask: s.ask, spans, phase: "testing", asked}, [asked]];
		},
		mutation_scope_err: (s): Step =>
			s.phase === "reading" ? end(s, {kind: "stuck", why: "read_failed"}) : stay(s),

		mutation_tests_ok: (s, m): Step => {
			if (s.phase !== "testing") return stay(s);
			const {result, failed, tail} = m.value;
			if (result === "red")
				return end(
					s,
					{kind: "send", to: "builder", why: "tests_red"},
					{spans: s.spans, failed, tail},
				);
			const {head, seed, most} = s.ask;
			const asked = runMutants({head, spans: s.spans, seed, most});
			return [{...scoped(s), phase: "mutating", asked}, [asked]];
		},
		mutation_tests_err: (s): Step =>
			s.phase === "testing"
				? end(s, {kind: "stuck", why: "run_failed"}, {spans: s.spans})
				: stay(s),

		mutation_run_ok: (s, m): Step =>
			s.phase === "mutating"
				? end(s, outcomeOf(m.value), {spans: s.spans, ran: m.value, ...trusting(s.ask)})
				: stay(s),
		mutation_run_err: (s): Step =>
			s.phase === "mutating"
				? end(s, {kind: "stuck", why: "run_failed"}, {spans: s.spans, ...trusting(s.ask)})
				: stay(s),
	},
});
