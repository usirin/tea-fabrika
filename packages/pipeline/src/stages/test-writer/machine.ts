import {defineMachine, type Sub} from "@demlik/tea";
import type {DraftMsg, DraftRun} from "@kampus/fabrika/agents/claude";
import {Schema} from "effect";
import {
	createRefineLoop,
	inFlight,
	type Refining,
	type Remember,
	remember,
	written as wrote,
} from "../../combos.ts";
import {act, checkRun, gather, intentOf} from "../../primitives.ts";
import {Pointer, Property, PropertyId, type WriterBrief, writer} from "./brief.ts";
import {
	Checked,
	cannotOf,
	Found,
	firstOf,
	Results,
	readRun,
	shows,
	TestsWritten,
	testsOf,
} from "./checked.ts";
import type {TestWriterOutcome} from "./outcome.ts";
import {File, problemsOf, testsWrite, Written} from "./written.ts";

// The test writer's first job (docs/direction/the-test-writer.md): after the
// owner's yes to the plan and before build, one test per Property, run on the
// plan's base. One agent sits inside it, the writer; code does the rest:
//
//   reading     which files at the base `includes` covers. A Gather
//   writing     the refine combo: the writer drafts, the pure Check
//               (./written.ts) reads the draft, its problems go back to it
//   committing  code commits the new files on the base, locally. An Act
//   running     the tests run on that commit. A Check that runs code
//               (`tests_on_base`), read with Controls (./checked.ts)
//   recording   one `checked` fact per Property and the `tests_written`
//               fact, written and read back: the remember combo
//   over        the outcome, and the report it was worked out from
//
// It ends on an ask the way the plan stage does: the outcome names it, and
// the lane puts the box on the ticket. It posts nothing itself.

const Unknown = ["unknown"] as const;

/** One run, as asked. `includes` is copied when the run is filed; `tries`: the most drafts the Check may send back for. */
export const TestsAsk = Schema.Struct({
	ticket: Schema.String,
	plan: Schema.Struct({version: Schema.Finite, summary: Schema.String}),
	base: Schema.String,
	properties: Schema.Array(Property),
	pointers: Schema.Array(Pointer),
	includes: Schema.Array(Schema.String),
	tries: Schema.Finite,
});
export type TestsAsk = typeof TestsAsk.Type;

export const readTaken = gather("tests_taken", {
	input: Schema.Struct({base: Schema.String, includes: Schema.Array(Schema.String)}),
	ok: Schema.Array(Schema.String),
	err: Unknown,
});

export const commitTests = act("tests_commit", {
	input: Schema.Struct({ticket: Schema.String, base: Schema.String, files: Schema.Array(File)}),
	ok: Schema.String,
	err: Unknown,
});

export const onBase = checkRun("tests_on_base", {
	input: Schema.Struct({
		commit: Schema.String,
		tests: Schema.Array(
			Schema.Struct({property: PropertyId, file: Schema.String, name: Schema.String}),
		),
	}),
	verdict: Results,
});

export const recordFacts = act("tests_record", {
	input: Schema.Struct({
		ticket: Schema.String,
		written: TestsWritten,
		checked: Schema.Array(Checked),
	}),
	ok: Schema.Null,
	err: Unknown,
});

export const readChecked = gather("tests_checked", {
	input: Schema.Struct({ticket: Schema.String, version: Schema.Finite, head: Schema.String}),
	ok: Schema.Array(Checked),
	err: Unknown,
});

type TakenCmd = ReturnType<typeof readTaken>;
type CommitCmd = ReturnType<typeof commitTests>;
type RunCmd = ReturnType<typeof onBase>;
type RecordCmd = ReturnType<typeof recordFacts>;
type ReadCmd = ReturnType<typeof readChecked>;
export type TestWriterCmd = TakenCmd | CommitCmd | RunCmd | RecordCmd | ReadCmd;

/** What a run leaves besides its outcome. */
export const TestWriterReport = Schema.Struct({
	/** The writer's answer: the one that passed, or the last one when the tries ran out. */
	written: Schema.NullOr(Written),
	/** The tests' local commit on the base. `null`: none was made. */
	commit: Schema.NullOr(Schema.String),
	checked: Schema.Array(Checked),
	/** Every Property the owner is asked about. The outcome names the first. */
	found: Schema.Array(Found),
	/** Why it stopped, in words, where the outcome alone does not say. */
	problems: Schema.Array(Schema.String),
	tries: Schema.Finite,
	costUsd: Schema.Finite,
});
export type TestWriterReport = typeof TestWriterReport.Type;

/** The refine combo over the writer and the Check. Each try's prompt is the brief, then only the Check's problems. */
export const refine = createRefineLoop({
	draft: testsWrite,
	check: problemsOf,
	prompt: writer.prompt,
	agent: null,
	folder: null,
});

/** How many times a restart may start the writer over. */
export const MAX_RESTARTS = 1;

type Held = {readonly ask: TestsAsk; readonly key: string};
type Drafted = Held & {
	readonly written: Written;
	readonly tries: number;
	readonly costUsd: number;
};

export type TestWriter =
	| {readonly phase: "idle"}
	| (Held & {readonly phase: "reading"; readonly asked: TakenCmd})
	| (Held & {
			readonly phase: "writing";
			readonly brief: WriterBrief;
			readonly refining: Refining<WriterBrief, Written>;
			readonly restarts: number;
			readonly costUsd: number;
	  })
	| (Drafted & {readonly phase: "committing"; readonly asked: CommitCmd})
	| (Drafted & {readonly phase: "running"; readonly commit: string; readonly asked: RunCmd})
	| (Drafted & {
			readonly phase: "recording";
			readonly commit: string;
			readonly checked: readonly Checked[];
			readonly found: readonly Found[];
			readonly remember: Remember<RecordCmd, ReadCmd>;
	  })
	| (Held & {
			readonly phase: "over";
			readonly outcome: TestWriterOutcome;
			readonly report: TestWriterReport;
	  });

type WriterMsg = DraftMsg<"tests_write", Written>;
export type TestWriterMsg =
	| {readonly type: "start"; readonly ask: TestsAsk; readonly key: string}
	/** Sent once after booting from saved state: re-issue whatever was in flight. */
	| {readonly type: "resume"}
	| WriterMsg;

type Step = readonly [TestWriter, readonly TestWriterCmd[]];
const stay = (s: TestWriter): Step => [s, []];
const held = (s: Held): Held => ({ask: s.ask, key: s.key});
const drafted = (s: Drafted): Drafted => ({
	...held(s),
	written: s.written,
	tries: s.tries,
	costUsd: s.costUsd,
});

const blank: TestWriterReport = {
	written: null,
	commit: null,
	checked: [],
	found: [],
	problems: [],
	tries: 0,
	costUsd: 0,
};
const end = (s: Held, outcome: TestWriterOutcome, report: Partial<TestWriterReport> = {}): Step => [
	{...held(s), phase: "over", outcome, report: {...blank, ...report}},
	[],
];
const spent = (s: Drafted) => ({written: s.written, tries: s.tries, costUsd: s.costUsd});

const intent = (s: Held, step: string) => intentOf("tests", s.ask.ticket, s.ask.plan.version, step);

/** Start the writer, on its first try or again after a restart under a new name. */
function writing(s: Held, brief: WriterBrief, restarts = 0, costUsd = 0): Step {
	const key = restarts === 0 ? s.key : `${s.key}/again/${restarts}`;
	const refining = refine.start(key, brief, s.ask.tries);
	return [{...held(s), phase: "writing", brief, refining, restarts, costUsd}, []];
}

/** A draft passed the Check: commit its tests, or ask at once when no Property got one. */
function commit(s: Drafted): Step {
	if (testsOf(s.written.answers).length === 0)
		return end(
			s,
			{kind: "ask", who: "owner", for: "cannot_test"},
			{...spent(s), found: cannotOf(s.written.answers)},
		);
	const asked = commitTests({
		ticket: s.ask.ticket,
		base: s.ask.base,
		files: s.written.files,
		intent: intent(s, "commit"),
	});
	return [{...drafted(s), phase: "committing", asked}, [asked]];
}

/**
 * A writer Msg, handed to the refine child. The Elm answer: the refine loop
 * is a child model kept inside this one's state; the parent hands it the Msgs
 * that are its (the Draft's) through its own `update`, and reads what the
 * child ended in to decide its own next phase (nested TEA, the OutMsg way).
 */
function draftMsg(s: TestWriter, m: Exclude<WriterMsg, {type: "tests_write_tool"}>): Step {
	if (s.phase !== "writing" || refine.runOf(s.refining)?.id !== m.id) return stay(s);
	const costUsd = s.costUsd + m.spend.costUsd;
	const next = refine.update(s.refining, m);
	switch (next.phase) {
		case "drafting":
			return [{...s, refining: next, costUsd}, []];
		case "done":
			return commit({...held(s), written: next.output, tries: next.tries, costUsd});
		case "out_of_tries":
			return end(
				s,
				{kind: "stuck", why: "unchecked"},
				{written: next.output, problems: next.problems, tries: next.tries, costUsd},
			);
		case "failed":
			return end(
				s,
				{kind: "stuck", why: "draft_failed"},
				{problems: [next.error], tries: next.tries, costUsd},
			);
	}
}

/** The writer's run: on only while a draft is asked for, in a copy of the code at the base. */
export const runSub = testsWrite.sub((s: TestWriter): DraftRun | null => {
	if (s.phase !== "writing") return null;
	const run = refine.runOf(s.refining);
	return run === null ? null : {...run, folder: s.ask.base};
});

export const testWriter = defineMachine({
	types: {
		model: {} as TestWriter,
		msg: {} as TestWriterMsg,
		sub: {} as Sub<"tests_write", DraftRun>,
		ctx: undefined,
	},
	cmds: [readTaken, commitTests, onBase, recordFacts, readChecked],
	init: (loaded) => [loaded ?? {phase: "idle"}, []],
	update: {
		start: (s, m): Step => {
			if (s.phase !== "idle") return stay(s);
			const at = {ask: m.ask, key: m.key};
			if (m.ask.properties.length === 0) return end(at, {kind: "skip", why: "no_properties"});
			const asked = readTaken({base: m.ask.base, includes: m.ask.includes});
			return [{...at, phase: "reading", asked}, [asked]];
		},
		resume: (s): Step => {
			if (s.phase === "reading" || s.phase === "committing" || s.phase === "running")
				return [s, [s.asked]];
			if (s.phase === "recording") return [s, [inFlight(s.remember)]];
			if (s.phase !== "writing") return stay(s);
			// The run that was on is gone with the process, and its conversation's name is taken.
			if (s.restarts >= MAX_RESTARTS)
				return end(
					s,
					{kind: "stuck", why: "cut_off"},
					{costUsd: s.costUsd, problems: [`the writer was cut off ${s.restarts + 1} times`]},
				);
			return writing(s, s.brief, s.restarts + 1, s.costUsd);
		},

		tests_taken_ok: (s, m): Step => {
			if (s.phase !== "reading") return stay(s);
			const {ticket, plan, base, properties, pointers, includes} = s.ask;
			const brief = writer.fill({
				ticket,
				plan,
				base,
				properties,
				pointers,
				includes,
				taken: m.value,
			});
			return writing(s, brief);
		},
		tests_taken_err: (s): Step =>
			s.phase === "reading" ? end(s, {kind: "stuck", why: "read_failed"}) : stay(s),

		tests_write_tool: (s): Step => stay(s),
		tests_write_finished: (s, m): Step => draftMsg(s, m),
		tests_write_failed: (s, m): Step => draftMsg(s, m),

		tests_commit_ok: (s, m): Step => {
			if (s.phase !== "committing") return stay(s);
			const tests = testsOf(s.written.answers).map(({property, file, name}) => ({
				property,
				file,
				name,
			}));
			const asked = onBase({commit: m.value, tests});
			return [{...drafted(s), phase: "running", commit: m.value, asked}, [asked]];
		},
		tests_commit_err: (s): Step =>
			s.phase === "committing" ? end(s, {kind: "stuck", why: "commit_failed"}, spent(s)) : stay(s),

		tests_on_base_ok: (s, m): Step => {
			if (s.phase !== "running") return stay(s);
			const tests = testsOf(s.written.answers);
			const read = readRun(s.ask.properties, tests, m.value, {
				version: s.ask.plan.version,
				head: s.commit,
			});
			if (!read.read)
				return end(
					s,
					{kind: "stuck", why: "no_result"},
					{
						...spent(s),
						commit: s.commit,
						problems: read.missing.map((p) => `the run on the base said nothing for ${p}'s test`),
					},
				);
			const write = recordFacts({
				ticket: s.ask.ticket,
				written: {fact: "tests_written", ticket: s.ask.ticket, commit: s.commit},
				checked: read.checked,
				intent: intent(s, "record"),
			});
			const back = readChecked({
				ticket: s.ask.ticket,
				version: s.ask.plan.version,
				head: s.commit,
			});
			const [r, cmds] = remember(write, back);
			const found = [...read.found, ...cannotOf(s.written.answers)];
			return [
				{
					...drafted(s),
					phase: "recording",
					commit: s.commit,
					checked: read.checked,
					found,
					remember: r,
				},
				cmds,
			];
		},
		tests_on_base_err: (s): Step =>
			s.phase === "running"
				? end(s, {kind: "stuck", why: "run_failed"}, {...spent(s), commit: s.commit})
				: stay(s),

		tests_record_ok: (s): Step => {
			if (s.phase !== "recording" || s.remember.step !== "writing") return stay(s);
			const [r, cmds] = wrote(s.remember);
			return [{...s, remember: r}, cmds];
		},
		tests_record_err: (s): Step =>
			s.phase === "recording" && s.remember.step === "writing"
				? end(
						s,
						{kind: "stuck", why: "record_failed"},
						{...spent(s), commit: s.commit, checked: s.checked, found: s.found},
					)
				: stay(s),

		tests_checked_ok: (s, m): Step => {
			if (s.phase !== "recording" || s.remember.step !== "reading") return stay(s);
			const report = {...spent(s), commit: s.commit, checked: s.checked, found: s.found};
			if (!shows(m.value, s.checked))
				return end(
					s,
					{kind: "stuck", why: "record_failed"},
					{...report, problems: ["the ledger, read after the write, does not show every result"]},
				);
			const first = firstOf(s.found);
			return end(
				s,
				first === null
					? {kind: "done", part: false, commit: s.commit}
					: {kind: "ask", who: "owner", for: first},
				report,
			);
		},
		tests_checked_err: (s): Step =>
			s.phase === "recording" && s.remember.step === "reading"
				? end(
						s,
						{kind: "stuck", why: "record_failed"},
						{...spent(s), commit: s.commit, checked: s.checked, found: s.found},
					)
				: stay(s),
	},
	subs: [runSub],
});
