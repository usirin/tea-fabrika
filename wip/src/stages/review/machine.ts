import {defineMachine, type Sub, type TimerSub} from "@demlik/tea";
import {Schema} from "effect";
import {nextTry} from "../../combos.ts";
import {act, gather, intentOf, listen} from "../../primitives.ts";
import {sentBack} from "../../refine.ts";
import {type Brief, reviewGate} from "./gate.ts";
import type {ReviewOutcome} from "./outcome.ts";
import {type Ask, Kind, Pack} from "./pack.ts";
import {Comment, render} from "./render.ts";
import {fenced, Ran, type Settings} from "./reviewer.ts";
import {type Form, Place, readForm} from "./sheet.ts";
import {Note, noteIdOf} from "./tools.ts";
import {criteriaOf, Judged, KindVerdict, outcomeOf, verdictsOf} from "./verdict.ts";

// The review machine: one pull request in, one typed outcome and a report
// out. One agent sits inside it, the reviewer, and the machine decides
// everything around it:
//
//   gathering  read the pack (./pack.ts), fresh, at the commit to review
//              then the gate (./gate.ts), a pure Check: go, wait, or the one reason not to
//   waiting    a required check is still running: Listen until none is, then read again
//   reviewing  the reviewer runs, as a Sub. Its stream says each note the agent
//              files, as it files it, and then how the run ended, once. A
//              form the Check refuses (./sheet.ts) goes back to a new run with
//              its problems, by refine's rule (`nextTry`, ../../combos.ts),
//              up to a limit of tries; every refused form's problems are kept
//   judging    the run is over and its answer is judged; the notes it filed
//              are still being filed. Over once every one is
//   over       the outcome, and the report it was worked out from
//
// The reviewer is a Sub, not a Cmd, because it keeps talking while it runs.
// A Cmd answers once. The agent's tool calls are Msgs as they are made: each
// `file_note` arrives as `review_note`, is kept in the state, and goes out
// again as an Act, `review_file_note`, whose intent is in the state first.
// Its form arrives last, on the same stream, as `review_reviewed`. Nothing in
// this file can reach the agent, and nothing the agent does reaches the state
// any other way.
//
// Its input is the pull request and the settings it starts with, and nothing
// else, so it runs alone or under a program, the same way.

const Unknown = ["unknown"] as const;

/** Read everything the reviewer needs, at the commit asked for. `head: null`: the head now. */
export const gatherPack = gather("review_pack", {
	input: Schema.Struct({
		pr: Schema.String,
		head: Schema.NullOr(Schema.String),
		rubrics: Schema.String,
	}),
	ok: Pack,
	err: Unknown,
});

/**
 * File one note the reviewer made. `kept`: it went where this run keeps
 * notes. A read-only run keeps it in its output and posts nothing; a run that
 * writes would open an issue here.
 */
export const fileNote = act("review_file_note", {
	input: Schema.Struct({pr: Schema.String, id: Schema.String, note: Note}),
	ok: Schema.Literals(["kept"]),
	err: Unknown,
});

type PackCmd = ReturnType<typeof gatherPack>;
type NoteCmd = ReturnType<typeof fileNote>;
export type ReviewCmd = PackCmd | NoteCmd;

type AtHead = {readonly pr: string; readonly head: string};
/**
 * One reviewer run. It is on while the machine is reviewing, and its runner
 * starts the agent. `run` numbers the runs of one review, so a run started
 * again after a restart is a Sub of its own, and an old one's Msgs are told
 * apart.
 */
export type RunSub = Sub<
	"review_run",
	AtHead & {
		readonly run: number;
		readonly brief: Brief;
		readonly settings: Settings;
		/** Why code refused the last try's form, and that form. `null`: a first try. */
		readonly note: string | null;
	}
>;
/** The required checks of one head. The runner says when none is still running, once. */
export type ChecksSub = Sub<"review_checks", AtHead>;

/** How long a wait on the checks may last, in ms. */
export interface Waits {
	readonly checksMs: number;
}
export const DEFAULT_WAITS: Waits = {checksMs: 15 * 60_000};

/**
 * How many times one review may start its reviewer: the first, and once more
 * after a restart. A restart in `reviewing` starts the agent again from
 * nothing, and pays again: a run cannot be picked up where it was cut.
 */
export const MAX_RUNS = 2;

/**
 * How many forms one review may ask the reviewer for: the first, and one
 * more, told what was wrong with the first, when code refuses it. Each try
 * is a new run, with the same limit in dollars as the first.
 */
export const DEFAULT_TRIES = 2;

export interface ReviewConfig {
	readonly waits?: Partial<Waits>;
	/** How many forms one review may ask for. {@link DEFAULT_TRIES} when left out. */
	readonly tries?: number;
}

/** A note as the report shows it. `failed`: it could not be filed. */
export const Kept = Schema.Struct({
	id: Schema.String,
	title: Schema.String,
	body: Schema.String,
	at: Schema.NullOr(Place),
	state: Schema.Literals(["kept", "failed"]),
});
export type Kept = typeof Kept.Type;

/** A note in the state: on its way, with the Act that files it, or settled. */
type Noted =
	| {readonly id: string; readonly note: Note; readonly state: "asked"; readonly asked: NoteCmd}
	| {readonly id: string; readonly note: Note; readonly state: "kept" | "failed"};

/**
 * What a review leaves besides its outcome: everything a reader needs to see
 * why. `criteria`: each one met or open (`criteriaOf`, ./verdict.ts), the
 * ticket's and the ones the review added. `comments`: what would be posted
 * for each kind; nothing is.
 */
export const Report = Schema.Struct({
	/** The commit reviewed. `null`: the pull request could not be read. */
	head: Schema.NullOr(Schema.String),
	replay: Schema.Boolean,
	criteria: Schema.Array(Judged),
	verdicts: Schema.Array(KindVerdict),
	/** The kinds of review the change owes that this stage does not do. */
	left: Schema.Array(Kind),
	comments: Schema.Array(Comment),
	notes: Schema.Array(Kept),
	/** Why the reviewer's answer could not be used, in words. */
	problems: Schema.Array(Schema.String),
	/**
	 * Each form code refused, in order, with its problems: the ones sent back
	 * for another try, and the last one when the tries ran out. Kept when a
	 * later try passes, so a review that ends well still shows what went wrong.
	 */
	refusals: Schema.Array(Schema.NonEmptyArray(Schema.String)),
	/** What the reviewer's last run left: its spend, its tools. `null`: none was started. */
	ran: Schema.NullOr(Ran),
	/** What every reviewer run of this review cost, in dollars: the tries sent back too. */
	cost: Schema.Finite,
	/** How many times the reviewer was started. */
	runs: Schema.Finite,
});
export type Report = typeof Report.Type;
/**
 * Every problem a report holds, once each, as a reader is shown it: each
 * refused form's problems, by the form's number, then why the review
 * stopped where that is something else.
 */
export function problemsOf(report: Pick<Report, "refusals" | "problems">): readonly string[] {
	const refused = report.refusals.flatMap((problems, at) =>
		problems.map((problem) => `form ${at + 1} refused: ${problem}`),
	);
	const last: readonly string[] = report.refusals.at(-1) ?? [];
	return [...refused, ...report.problems.filter((problem) => !last.includes(problem))];
}

/** A report before its notes are all filed. */
type Judgement = Omit<Report, "notes">;

/**
 * `waits` and `limit` (how many forms it may ask for): the limits this run
 * started with, kept so a restart goes by the same numbers.
 */
type Held = {
	readonly ask: Ask;
	readonly settings: Settings;
	readonly waits: Waits;
	readonly limit: number;
};
type Sofar = Held & {readonly waited: number};

/** The forms code refused so far, each by its problems. */
type Refusals = readonly (readonly [string, ...string[]])[];

export type Review =
	| {readonly phase: "idle"}
	| (Sofar & {readonly phase: "gathering"; readonly asked: PackCmd})
	| (Sofar & {readonly phase: "waiting"; readonly head: string})
	| (Held & {
			readonly phase: "reviewing";
			readonly brief: Brief;
			readonly replay: boolean;
			/** The reviewer's runs, the one on included. Each try and each start after a restart is one. */
			readonly run: number;
			/** The forms asked for, the one on its way included. */
			readonly tries: number;
			/** How many times a run was cut off by a restart. */
			readonly cuts: number;
			/** What this try is told about the last one. `null`: the first try. */
			readonly note: string | null;
			readonly refusals: Refusals;
			/** What the runs before this one cost, in dollars. */
			readonly spent: number;
			readonly notes: readonly Noted[];
	  })
	| (Held & {
			readonly phase: "judging";
			readonly outcome: ReviewOutcome;
			readonly judgement: Judgement;
			readonly notes: readonly Noted[];
	  })
	| (Held & {readonly phase: "over"; readonly outcome: ReviewOutcome; readonly report: Report});

/** Why a run left no form. `misfit`: it ended with an answer that is not a form. */
export type Failed = "broke" | "misfit" | "over_budget";

type FromRun = AtHead & {readonly run: number};
export type ReviewMsg =
	| {readonly type: "start"; readonly ask: Ask; readonly settings: Settings}
	/** Sent once after booting from saved state: re-issue whatever was in flight. */
	| {readonly type: "resume"}
	| {readonly type: "review_checks"; readonly pr: string; readonly head: string}
	| {
			readonly type: "review_checks_overdue";
			readonly pr: string;
			readonly head: string;
			readonly wait: number;
	  }
	/** From the reviewer's run: the agent called `file_note`. */
	| (FromRun & {readonly type: "review_note"; readonly note: Note})
	/** From the reviewer's run, last: its form, read against the form's schema on the way in. */
	| (FromRun & {readonly type: "review_reviewed"; readonly form: Form; readonly ran: Ran})
	/** From the reviewer's run, last: it left no form. */
	| (FromRun & {
			readonly type: "review_failed";
			readonly why: Failed;
			readonly error: string | null;
			readonly ran: Ran;
	  });

type Step = readonly [Review, readonly ReviewCmd[]];

const stay = (s: Review): Step => [s, []];
const held = (s: Held): Held => ({
	ask: s.ask,
	settings: s.settings,
	waits: s.waits,
	limit: s.limit,
});
/** A judgement before any reviewer ran. */
const empty = (head: string | null, replay: boolean): Judgement => ({
	head,
	replay,
	criteria: [],
	verdicts: [],
	left: [],
	comments: [],
	problems: [],
	refusals: [],
	ran: null,
	cost: 0,
	runs: 0,
});
/**
 * A judgement once a reviewer has run: every end from `reviewing` starts
 * here, so none can leave out the forms refused before it or what they cost.
 */
const afterRuns = (s: Reviewing, ran: Ran | null): Judgement => ({
	...empty(s.brief.head, s.replay),
	left: s.brief.left,
	refusals: s.refusals,
	ran,
	cost: s.spent + (ran?.spend.costUsd ?? 0),
	runs: s.run,
});

/**
 * What the reviewer is told on its next try: the problems, in refine's own
 * words (`sentBack`, ../../refine.ts), and the form they were found in. The
 * next try is a new run that does not remember this one, so the form goes too.
 */
export const sentBackForm =
	(form: Form) =>
	(problems: readonly [string, ...string[]]): string =>
		[
			sentBack(problems),
			"",
			"The form that was handed back:",
			"",
			fenced(JSON.stringify(form, null, 2), "json"),
		].join("\n");
const kept = (notes: readonly Noted[]): readonly Kept[] =>
	notes.flatMap((n) => (n.state === "asked" ? [] : [{id: n.id, ...n.note, state: n.state}]));
const asked = (notes: readonly Noted[]): readonly NoteCmd[] =>
	notes.flatMap((n) => (n.state === "asked" ? [n.asked] : []));

/** The run is over: wait for the notes still being filed, or end now. */
function end(
	s: Held,
	outcome: ReviewOutcome,
	judgement: Judgement,
	notes: readonly Noted[] = [],
): Step {
	return asked(notes).length > 0
		? [{...held(s), phase: "judging", outcome, judgement, notes}, []]
		: [{...held(s), phase: "over", outcome, report: {...judgement, notes: kept(notes)}}, []];
}

function read(s: Sofar): Step {
	const asked = gatherPack({pr: s.ask.pr, head: s.ask.head, rubrics: s.ask.rubrics});
	return [{...held(s), waited: s.waited, phase: "gathering", asked}, [asked]];
}

const isRun = (s: Review, m: FromRun): s is Extract<Review, {phase: "reviewing"}> =>
	s.phase === "reviewing" && m.pr === s.brief.pr && m.head === s.brief.head && m.run === s.run;

type Reviewing = Extract<Review, {phase: "reviewing"}>;

/**
 * What the run's end makes of the review, from its form. A form the Check
 * refuses goes back for another try while tries are left (`nextTry`); its
 * problems are kept either way.
 */
function judged(s: Reviewing, form: Form, ran: Ran): Step {
	const made = readForm(s.brief, form);
	if (made.answer === "problems") {
		const refusals: Refusals = [...s.refusals, made.problems];
		const tried = nextTry(made.problems, s.tries, s.limit, sentBackForm(form));
		if (tried.go === "again")
			return [
				{
					...s,
					run: s.run + 1,
					tries: tried.tries,
					note: tried.note,
					refusals,
					spent: s.spent + ran.spend.costUsd,
				},
				[],
			];
		return end(
			s,
			{kind: "stuck", why: "draft_failed"},
			{...afterRuns({...s, refusals}, ran), problems: made.problems},
			s.notes,
		);
	}
	const base = afterRuns(s, ran);
	const verdicts = verdictsOf(s.brief.kinds, made.sheet);
	return end(
		s,
		outcomeOf(s.brief, verdicts),
		{
			...base,
			criteria: criteriaOf(s.brief, made.sheet),
			verdicts,
			comments: render(s.brief, made.sheet, verdicts),
		},
		s.notes,
	);
}

/** Settle the note whose Act this answers, and end when the run is over and none is left on its way. */
function settled(s: Review, intent: string, state: "kept" | "failed"): Step {
	if (s.phase !== "reviewing" && s.phase !== "judging") return stay(s);
	const notes = s.notes.map(
		(n): Noted =>
			n.state === "asked" && n.asked.intent === intent ? {id: n.id, note: n.note, state} : n,
	);
	if (s.phase === "reviewing") return [{...s, notes}, []];
	return end(s, s.outcome, s.judgement, notes);
}

/** The reviewer's run: on only while reviewing. */
export const runSub = listen("review_run", (s: Review) =>
	s.phase === "reviewing"
		? {
				pr: s.brief.pr,
				head: s.brief.head,
				run: s.run,
				brief: s.brief,
				settings: s.settings,
				note: s.note,
			}
		: null,
);
/** The Listen on the checks: on only while they run. */
export const checksSub = listen("review_checks", (s: Review) =>
	s.phase === "waiting" ? {pr: s.ask.pr, head: s.head} : null,
);
/** The clock beside it. Its Msg names the wait it was set for, so each wait sets a new clock. */
export const checksClock = listen("timer", (s: Review) =>
	s.phase === "waiting"
		? {
				ms: s.waits.checksMs,
				msg: {
					type: "review_checks_overdue" as const,
					pr: s.ask.pr,
					head: s.head,
					wait: s.waited,
				},
			}
		: null,
);

/** A review machine, made with its own limits, copied into each run's state when it starts. */
export function createReview(config: ReviewConfig = {}) {
	const waits: Waits = {...DEFAULT_WAITS, ...config.waits};
	const limit = Math.max(1, config.tries ?? DEFAULT_TRIES);
	return defineMachine({
		types: {
			model: {} as Review,
			msg: {} as ReviewMsg,
			sub: {} as RunSub | ChecksSub | TimerSub<ReviewMsg>,
			ctx: undefined,
		},
		cmds: [gatherPack, fileNote],
		init: (loaded) => [loaded ?? {phase: "idle"}, []],
		update: {
			start: (s, m): Step =>
				s.phase === "idle"
					? read({ask: m.ask, settings: m.settings, waits, limit, waited: 0})
					: stay(s),
			resume: (s): Step => {
				if (s.phase === "gathering") return [s, [s.asked]];
				if (s.phase === "judging") return [s, asked(s.notes)];
				if (s.phase !== "reviewing") return stay(s);
				// The run that was on is gone with the process. Start it again, once; its notes so far are kept.
				const cuts = s.cuts + 1;
				if (cuts >= MAX_RUNS)
					return end(
						s,
						{kind: "stuck", why: "over_budget"},
						{
							...afterRuns(s, null),
							problems: [`the reviewer was cut off ${cuts} times, and is not started again`],
						},
						s.notes,
					);
				return [{...s, run: s.run + 1, cuts}, asked(s.notes)];
			},

			review_pack_ok: (s, m): Step => {
				if (s.phase !== "gathering") return stay(s);
				const pack = m.value;
				const gate = reviewGate(pack);
				switch (gate.answer) {
					case "stop":
						return end(s, gate.outcome, {...empty(pack.head, pack.replay), left: pack.kinds ?? []});
					case "wait_for_checks":
						return [{...held(s), phase: "waiting", head: gate.head, waited: s.waited + 1}, []];
					case "go":
						return [
							{
								...held(s),
								phase: "reviewing",
								brief: gate.brief,
								replay: pack.replay,
								run: 1,
								tries: 1,
								cuts: 0,
								note: null,
								refusals: [],
								spent: 0,
								notes: [],
							},
							[],
						];
				}
			},
			review_pack_err: (s): Step =>
				s.phase === "gathering"
					? end(s, {kind: "stuck", why: "read_failed"}, empty(null, s.ask.head !== null))
					: stay(s),

			// The Listen says only that the checks settled. How they went is read fresh, through the gate again.
			review_checks: (s, m): Step =>
				s.phase === "waiting" && m.pr === s.ask.pr && m.head === s.head ? read(s) : stay(s),
			review_checks_overdue: (s, m): Step =>
				s.phase === "waiting" && m.head === s.head && m.wait === s.waited
					? end(s, {kind: "stuck", why: "checks_stuck"}, empty(s.head, s.ask.head !== null))
					: stay(s),

			// A note is kept once, by its id, and filed by an Act whose intent is in the state before it goes.
			review_note: (s, m): Step => {
				if (!isRun(s, m)) return stay(s);
				const id = noteIdOf(m.note);
				if (s.notes.some((n) => n.id === id)) return stay(s);
				const cmd = fileNote({
					pr: s.brief.pr,
					id,
					note: m.note,
					intent: intentOf("review", s.brief.pr, s.brief.head, "note", id),
				});
				return [{...s, notes: [...s.notes, {id, note: m.note, state: "asked", asked: cmd}]}, [cmd]];
			},
			review_reviewed: (s, m): Step => (isRun(s, m) ? judged(s, m.form, m.ran) : stay(s)),
			review_failed: (s, m): Step => {
				if (!isRun(s, m)) return stay(s);
				const base = afterRuns(s, m.ran);
				if (m.why === "over_budget")
					return end(
						s,
						{kind: "stuck", why: "over_budget"},
						{...base, problems: [`the reviewer reached its limit of ${s.settings.budget} dollars`]},
						s.notes,
					);
				const problem =
					m.why === "misfit"
						? "what the reviewer handed back does not read as a form"
						: (m.error ?? "the reviewer broke");
				return end(
					s,
					{kind: "stuck", why: "draft_failed"},
					{...base, problems: [problem]},
					s.notes,
				);
			},

			review_file_note_ok: (s, m): Step => settled(s, m.cmd.intent, "kept"),
			// The review stands without it. The report says it was not filed.
			review_file_note_err: (s, m): Step => settled(s, m.cmd.intent, "failed"),
		},
		subs: [runSub, checksSub, checksClock],
	});
}

/** A review machine with every limit at its default. */
export const review = createReview();
