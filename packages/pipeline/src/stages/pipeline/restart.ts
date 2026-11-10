import {Effect, Option, Schema} from "effect";
import {type Checked, Entry, type FactOf} from "../../tickets/ticket.ts";
import {Tickets, type TicketsFailed} from "../../tickets/tickets.ts";
import {nameOf} from "../outcome.ts";
import {HeldDraft} from "../plan/plan.ts";
import {
	type AskFor,
	askedFor,
	askedStep,
	Carry,
	EMPTY,
	Held,
	LaneStep,
	letThrough,
	Resume,
	resumeAfter,
	resumeOf,
	STEPS,
	saidYes,
	StepEnd,
	withNote,
} from "./machine.ts";
import {LaneWork} from "./work.ts";

// What may restart, and the carry from facts (self-fix PR 5, P4 and P6). Today's version.
//
//   A stop saves its `Held` and where it goes on. The same line typed again goes on there.
//   FINAL: the closed list of stops that never restart (./outcome.ts). Every other one does, a new
//   one included.
//   fold(seen): the second copy of a stop's `Held`, rebuilt from the ticket's facts and the commits
//   code made. A field no fact proves is named in `missing`, and the lane goes on at the step that
//   writes that field, and no earlier.
//
//   fold(seen)
//   // {held: {count: 6, round: 1, carry: {plan, version: 1, base, exam, head, checked, ...}, trail},
//   //  missing: [], at: {_tag: "run", step: "mutation"}}
//
// Each `ended` fact a lane writes keeps what its step left (`carry`), so the fold of those is the
// carry the lane held, step by step, with each answer's note and `go_on` laid on as the lane lays
// them. An `ended` written before that key proves what the facts and commits beside it prove: the
// plan from the ledger, the base and the commits from the lane's branch, the checks from `checked`.

export {FINAL} from "./outcome.ts";

/** The fields of a carry the fold proves from facts, each with the step that writes it. */
export const Field = Schema.Literals([
	"plan",
	"version",
	"rules",
	"decided",
	"base",
	"exam",
	"head",
	"count",
	"trail",
]);
export type Field = typeof Field.Type;

/** A commit code made on the lane's branch: which step it was made for, and the files it touched. */
export const Made = Schema.Struct({
	sha: Schema.String,
	by: Schema.Union([LaneStep, Schema.Literal("format")]),
	files: Schema.Array(Schema.String),
});
export type Made = typeof Made.Type;

/** What the fold reads. */
export const Seen = Schema.Struct({
	/** The ticket's facts, oldest first. */
	timeline: Schema.Array(Entry),
	/** The plan the ledger keeps for this ticket, newest version, as the lane held it. `null`: none. */
	plan: Schema.NullOr(HeldDraft),
	/** Where the lane's working copy left main. `null`: there is no working copy. */
	base: Schema.NullOr(Schema.String),
	/** The commits code made on the lane's branch, oldest first. */
	commits: Schema.Array(Made),
});
export type Seen = typeof Seen.Type;

/** A stop's `Held` as the facts prove it, what they could not prove, and where the lane goes on. */
export const Folded = Schema.Struct({
	held: Schema.Struct({
		count: Held.fields.count,
		round: Held.fields.round,
		carry: Carry,
		trail: Held.fields.trail,
	}),
	missing: Schema.Array(Field),
	at: Resume,
});
export type Folded = typeof Folded.Type;

const isStep = Schema.is(LaneStep);
const changeOf = Schema.decodeUnknownOption(StepEnd.fields.carry);

/** How early a place to go on is: by its step, and a question after the step it is about. Pure. */
const rank = (at: Resume): number => STEPS.indexOf(at.step) * 2 + (at._tag === "ask" ? 1 : 0);

/** Where the lane goes on when no fact proves a field: the step that writes it. */
const WRITES: Readonly<Partial<Record<Field, Resume>>> = {
	plan: {_tag: "run", step: "plan"},
	version: {_tag: "run", step: "plan"},
	rules: {_tag: "run", step: "plan"},
	decided: {_tag: "ask", for: "approve", step: "plan"},
	base: {_tag: "run", step: "test_writer"},
	exam: {_tag: "run", step: "test_writer"},
	head: {_tag: "run", step: "test_writer"},
};

/** The commits each step makes, for an `ended` written before it kept its carry. */
const MADE_BY: Readonly<Partial<Record<LaneStep, ReadonlySet<Made["by"]>>>> = {
	test_writer: new Set(["test_writer"]),
	build: new Set(["format", "build"]),
	mutants: new Set(["mutants", "format"]),
};

/** A `checked` fact as a carry holds it. Pure. */
const checksOf = ({head, commands, result, failed}: FactOf<"checked">): Checked => ({
	head,
	commands,
	result,
	failed,
});

/** The fold of a lane's facts. Pure. */
export const fold = (seen: Seen): Folded => {
	const missing = new Set<Field>();
	const commits = [...seen.commits];
	const runs = new Set<string>();
	const kinds = new Map<string, AskFor>();
	let carry: Carry = EMPTY;
	let trail: Held["trail"] = [];
	let round = 1;
	let at: Resume = {_tag: "run", step: "triage"};
	/** The step that ended last: a question is about it. */
	let last: LaneStep = "triage";
	/** The checks code ran in the run going now. `undefined`: no run is going. */
	let inRun: FactOf<"checked"> | null | undefined;
	let version: number | null = null;
	let approved = false;
	let pastPlan = false;

	/** The commits `step` made, taken off the front of the branch's list. */
	const madeBy = (step: LaneStep): readonly Made[] => {
		const by = MADE_BY[step];
		const made: Made[] = [];

		for (let next = commits[0]; next !== undefined && by?.has(next.by); next = commits[0]) {
			made.push(next);
			commits.shift();
		}

		return made;
	};

	/** What an `ended` written before it kept its carry proves, from the facts and commits beside it. */
	const proven = (step: LaneStep, outcome: FactOf<"ended">["outcome"]): Carry => {
		const made = madeBy(step);
		const head = made.at(-1)?.sha ?? null;
		const checks = inRun === null || inRun === undefined ? {} : {checked: checksOf(inRun)};

		switch (step) {
			case "plan":
				if (outcome.kind !== "done" && outcome.kind !== "ask") {
					return carry;
				}

				if (seen.plan === null) {
					missing.add("plan");
				}

				if (version === null) {
					missing.add("version");
				}

				return {
					...carry,
					plan: seen.plan,
					version,
					rules: (seen.plan?.exam ?? []).map((change) => change.path),
					decided: {questions: [], said: []},
				};
			case "test_writer": {
				const base = round > 1 ? carry.base : seen.base;

				if (base === null) {
					missing.add("base");
				}

				const files = made.flatMap((c) => c.files);

				if (outcome.kind === "done" && files.length === 0) {
					missing.add("exam");
				}

				return {...carry, base, head: head ?? base, exam: [...carry.exam, ...files]};
			}
			case "build":
				return {...carry, head: head ?? carry.head, ...checks};
			case "mutants":
				return {
					...carry,
					head: head ?? carry.head,
					exam: [...carry.exam, ...made.filter((c) => c.by === "mutants").flatMap((c) => c.files)],
					...checks,
				};
			default:
				return carry;
		}
	};

	for (const {fact} of seen.timeline) {
		switch (fact.type) {
			case "started":
				if (!isStep(fact.stage)) {
					break;
				}

				runs.add(fact.run);
				round = fact.round ?? 1;
				inRun = null;

				if (STEPS.indexOf(fact.stage) > STEPS.indexOf("plan")) {
					pastPlan = true;
				}

				break;
			case "checked":
				// An exam head's, with its pull request: never the lane's own (self-fix PR 10).
				if (fact.pr !== undefined) {
					break;
				}

				// In a run: the run's own. Out of one: a restart's, at the head main's new base gave.
				if (inRun !== undefined) {
					inRun = fact;
				} else {
					carry = {...carry, head: fact.head, checked: checksOf(fact)};
				}

				break;
			case "planned":
				version = fact.version;
				break;
			case "ended": {
				if (!isStep(fact.stage)) {
					break;
				}

				trail = [...trail, {step: fact.stage, said: nameOf(fact.outcome)}];
				const change = fact.carry === undefined ? Option.none() : changeOf(fact.carry);
				carry = Option.isSome(change)
					? {...carry, ...change.value}
					: proven(fact.stage, fact.outcome);

				if (fact.stage === "plan") {
					approved = false;
				}

				last = fact.stage;
				inRun = undefined;
				at = resumeAfter(fact.stage, fact.outcome, round, trail);
				break;
			}
			case "asked": {
				const kind = askedFor(fact.ask);

				if (kind === null) {
					break;
				}

				kinds.set(fact.ask, kind);
				const step = askedStep(kind, last);
				at = kind === "step" ? {_tag: "run", step} : {_tag: "ask", for: kind, step};
				break;
			}
			case "answered": {
				// The first answer to a lane's question is the one it took.
				const kind = kinds.get(fact.ask);

				if (kind === undefined) {
					break;
				}

				kinds.delete(fact.ask);
				trail = [...trail, {step: fact.ask, said: fact.pick}];
				// A `merge` on the exam's pull request is a yes on what its review read, as the lane lays it.
				const said = kind === "exam_merge" && fact.pick === "merge" ? saidYes(carry) : carry;
				const noted = withNote(said, fact.note);
				carry = fact.pick === "go_on" ? letThrough(noted) : noted;

				if (kind === "approve" && fact.pick === "approve") {
					approved = true;
				}

				const step = askedStep(kind, last);
				at = resumeOf({ask: fact.ask, what: "", picks: [], for: kind, step}, fact.pick);
				break;
			}
			case "restarted":
				// The branch started again from main: nothing built or written before stands on it.
				if (fact.kept !== undefined) {
					carry = {
						...carry,
						base: fact.onto,
						head: fact.to ?? fact.onto,
						exam: [],
						written: null,
						touched: [],
						cannot: [],
					};
				}
				// Main moved under a working copy: the lane's commits now stand on it, at the head the restart
				// kept, or else the branch's last.
				else if (fact.base !== null && fact.base !== fact.onto) {
					const head = fact.to ?? seen.commits.at(-1)?.sha ?? carry.head;
					carry = {...carry, base: fact.onto, head};
				}

				break;
			default:
				break;
		}
	}

	if (pastPlan && !approved) {
		missing.add("decided");
	}

	const goesOn = [...missing].flatMap((field) => WRITES[field] ?? []);
	return {
		held: {count: runs.size, round, carry, trail},
		missing: Field.literals.filter((field) => missing.has(field)),
		at: goesOn.reduce((a, b) => (rank(b) < rank(a) ? b : a), at),
	};
};

/** The step a commit on the lane's branch was made for, by the title code gave it. Pure. */
const byTitle = (title: string, built: boolean): Made["by"] => {
	if (title.startsWith("format the tests")) {
		return "format";
	}

	// Tests after a build are the mutants' answers.
	if (title.startsWith("tests for ")) {
		return built ? "mutants" : "test_writer";
	}

	return "build";
};

/**
 * What the fold of ticket `number`'s lane reads, read now. The plan is `null`: the ledger keeps the
 * plan's revision, not the draft the lane held, so a lane whose ends kept no carry writes its plan again.
 * A ticket that cannot be read fails it: a fold of no facts would run the lane again from triage. The
 * branch's commits may be missing: a lane that never built has none.
 */
export const seenOf = (number: number): Effect.Effect<Seen, TicketsFailed, Tickets | LaneWork> =>
	Effect.gen(function* () {
		const tickets = yield* Tickets;
		const work = yield* LaneWork;
		const {timeline} = yield* tickets.read(number);
		const branch = `lane/${number}`;
		const base = yield* work
			.mergeBase("origin/main", branch)
			.pipe(Effect.orElseSucceed((): string | null => null));

		if (base === null) {
			return {timeline, plan: null, base, commits: []};
		}

		const listed = yield* work.commits(base, branch).pipe(Effect.orElseSucceed(() => []));
		const commits: Made[] = [];

		for (const {sha, title} of listed) {
			const files = yield* work
				.filesOf(work.at("clone"), sha)
				.pipe(Effect.orElseSucceed((): readonly string[] => []));
			commits.push({
				sha,
				by: byTitle(
					title,
					commits.some((c) => c.by === "build"),
				),
				files,
			});
		}

		return {timeline, plan: null, base, commits};
	});
