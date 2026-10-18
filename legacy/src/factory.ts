import {applyCell, defineMachine, type Migrated, refuse} from "@demlik/tea";
import {weigh} from "./comments.ts";
import {gatherFacts} from "./facts.ts";
import {
	building,
	type Lane,
	type LaneCmd,
	type LaneKnobs,
	lane,
	type ParkAnswer,
	prepare,
} from "./lane.ts";
import {
	findMissing,
	inspect,
	match,
	missingLine,
	type ReviewParkAnswer,
	route,
	whereOf,
} from "./review.ts";
import {
	catchUp,
	land,
	retest,
	type Ship,
	type ShipCmd,
	type ShipInput,
	type ShipParkAnswer,
	seal,
	ship,
} from "./ship.ts";
import {isBuildable, type SortTimerMsg, sortAsk} from "./sort.ts";
import {apiLine, type NewExports, ticketNames} from "./surface.ts";
import {fetchComments, fetchTicket} from "./tracker.ts";
import {
	enrichment,
	type Triage,
	type TriageCmd,
	type TriageKnobs,
	type TriageParkAnswer,
	triage,
} from "./triage.ts";

/**
 * The whole pipeline as one machine: triage, the lane and ship are parts of
 * its state, and it steps each one with that machine's own `update`. What the
 * factory adds is the hand-offs between them.
 */
export interface Factory {
	readonly triage: Triage;
	readonly lane: Lane;
	readonly ship: Ship;
	/** What the lane will start with, set when the issue is filed. */
	readonly filed: Filed | null;
}

/** What each part takes from `fabrika.toml`. `knobsOf` in `settings.ts` reads it off the settings. */
export interface Knobs {
	readonly triage: TriageKnobs;
	readonly lane: LaneKnobs;
}

interface Filed {
	/** The conversation the lane's builder will have. */
	readonly builder: string;
	readonly lane: LaneKnobs;
}

export type FactoryMsg =
	/**
	 * A ticket was filed: only its id, since triage reads it from the tracker.
	 * `builder` names the lane's builder conversation, and `knobs` come from the
	 * settings; the host makes both, so the reducer stays pure.
	 */
	| {readonly type: "file"; readonly issue: string; readonly builder: string; readonly knobs: Knobs}
	/** Sent once after booting from saved state: every part re-issues what it was waiting on. */
	| {readonly type: "resume"; readonly at: number}
	/** A person's answer to a park: the part that is parked gets it. */
	| {
			readonly type: "answer";
			readonly answer: ParkAnswer | ReviewParkAnswer | TriageParkAnswer | ShipParkAnswer;
			readonly at: number;
	  }
	| SortTimerMsg;

export type FactoryCmd = TriageCmd | LaneCmd | ShipCmd;
type Step = readonly [Factory, readonly FactoryCmd[]];
type AnyMsg = {readonly type: string};

const toTriage = <M extends AnyMsg>(s: Factory, msg: M): Step => {
	const [next, cmds] = applyCell<Triage, AnyMsg, TriageCmd>(triage, s.triage, msg);
	return [{...s, triage: next}, cmds];
};

const toLane = <M extends AnyMsg>(s: Factory, msg: M): Step => {
	const [next, cmds] = applyCell<Lane, AnyMsg, LaneCmd>(lane, s.lane, msg);
	return [{...s, lane: next}, cmds];
};

const toShip = <M extends AnyMsg>(s: Factory, msg: M): Step => {
	const [next, cmds] = applyCell<Ship, AnyMsg, ShipCmd>(ship, s.ship, msg);
	return [{...s, ship: next}, cmds];
};

/** What the person approving the change reads: what the lane left on the record. */
function recordOf(done: Extract<Lane, {phase: "done"}>): ShipInput {
	return {
		issue: done.issue.id,
		title: done.issue.title,
		missing: done.missing,
		record: [
			`${done.attempt} attempt(s), ${done.builds} build(s)`,
			missingLine(done.missing),
			...done.deviations.map((d) => `extra change ${d.file}: ${d.why}`),
			...done.published.map(apiLine),
			...done.notes.map((f) => `filed ${f.id} ${whereOf(f)}: ${f.problem}`),
			...done.matched.map((m) => `${m.finding.id} taken as ${m.to} again: ${m.finding.problem}`),
			...done.withdrawn.map((f) => `withdrawn ${f.id}: ${f.problem}`),
			...done.comments.map(
				(c) =>
					`comment ${c.id}, settled by the ${c.state.kind === "settled" ? c.state.by : "?"}: ${c.text}`,
			),
		],
	};
}

/**
 * The hand-offs: an issue triage sorted as a buildable type starts the lane,
 * and a lane that is done starts ship. Everything else stays where its part
 * left it. Triage only reaches `triaged` with no call left open, so there is no
 * "is this for an agent" left to ask here.
 */
function handOff([s, cmds]: Step): Step {
	if (
		s.lane.phase === "idle" &&
		s.filed !== null &&
		s.triage.phase === "triaged" &&
		isBuildable(s.triage.type)
	) {
		const [next, more] = toLane(s, {
			type: "start",
			issue: s.triage.issue,
			session: s.filed.builder,
			knobs: s.filed.lane,
			named: ticketNames(s.triage.raw, s.triage.facts),
		});
		return handOff([next, [...cmds, ...more]]);
	}
	if (s.lane.phase === "done" && s.ship.phase === "idle") {
		const [next, more] = toShip(s, {type: "start", input: recordOf(s.lane)});
		return [next, [...cmds, ...more]];
	}
	return [s, cmds];
}

/** Which part a person's answer is for: the one that is parked. Only one ever is. */
function answer(s: Factory, m: Extract<FactoryMsg, {type: "answer"}>): Step {
	if (s.triage.phase === "parked") return handOff(toTriage(s, m));
	if (s.ship.phase === "parked") return toShip(s, m);
	return handOff(toLane(s, m));
}

const laneCell = (s: Factory, m: AnyMsg): Step => handOff(toLane(s, m));
const triageCell = (s: Factory, m: AnyMsg): Step => handOff(toTriage(s, m));
const shipCell = (s: Factory, m: AnyMsg): Step => toShip(s, m);

export const factory = defineMachine({
	types: {model: {} as Factory, msg: {} as FactoryMsg, ctx: undefined},
	cmds: [
		fetchTicket,
		gatherFacts,
		enrichment.write,
		enrichment.check,
		sortAsk.run,
		prepare,
		building.write,
		building.check,
		route,
		inspect,
		match,
		findMissing,
		fetchComments,
		weigh,
		seal,
		land,
		catchUp,
		retest,
	],
	init: (loaded) => [
		loaded ?? {triage: {phase: "idle"}, lane: {phase: "idle"}, ship: {phase: "idle"}, filed: null},
		[],
	],
	update: {
		file: (s, m): Step =>
			s.triage.phase === "idle"
				? handOff(
						toTriage(
							{...s, filed: {builder: m.builder, lane: m.knobs.lane}},
							{type: "file", issue: m.issue, knobs: m.knobs.triage},
						),
					)
				: [s, []],
		resume: (s, m): Step => {
			const [afterTriage, triageCmds] = toTriage(s, m);
			const [afterLane, laneCmds] = toLane(afterTriage, m);
			const [afterShip, shipCmds] = toShip(afterLane, {type: "resume"});
			return handOff([afterShip, [...triageCmds, ...laneCmds, ...shipCmds]]);
		},
		answer: (s, m): Step => answer(s, m),
		fetch_ticket_ok: triageCell,
		fetch_ticket_err: triageCell,
		gather_facts_ok: triageCell,
		gather_facts_err: triageCell,
		enrich_write_ok: triageCell,
		enrich_write_err: triageCell,
		enrich_check_ok: triageCell,
		enrich_check_err: triageCell,
		// Only triage asks Jev through tea's Jev door; the lane's Jev plug-ins sit behind their own services.
		sort_run_ok: triageCell,
		sort_run_err: triageCell,
		sort_deadline: triageCell,
		prepare_ok: laneCell,
		prepare_err: laneCell,
		build_write_ok: laneCell,
		build_write_err: laneCell,
		build_check_ok: laneCell,
		build_check_err: laneCell,
		route_ok: laneCell,
		route_err: laneCell,
		inspect_ok: laneCell,
		inspect_err: laneCell,
		match_ok: laneCell,
		match_err: laneCell,
		find_missing_ok: laneCell,
		find_missing_err: laneCell,
		fetch_comments_ok: laneCell,
		fetch_comments_err: laneCell,
		weigh_ok: laneCell,
		weigh_err: laneCell,
		seal_ok: shipCell,
		seal_err: shipCell,
		land_ok: shipCell,
		land_err: shipCell,
		catch_up_ok: shipCell,
		catch_up_err: shipCell,
		retest_ok: shipCell,
		retest_err: shipCell,
	},
	subs: [
		{
			type: "timer",
			deps: (s: Factory) => (s.triage.phase === "sorting" ? sortAsk.timer(s.triage.sort) : null),
		},
	],
});

/**
 * The knobs every run had before they moved to `fabrika.toml`: the constants
 * the code held then. A state saved before that ran by exactly these, so
 * filling them in is what happened, not a guess. Written out rather than taken
 * from `DEFAULT_SETTINGS`, whose values may change.
 */
export const BEFORE_SETTINGS: {
	readonly triage: Pick<TriageKnobs, "sortFloor">;
	readonly lane: Omit<LaneKnobs, "newExports">;
} = {
	triage: {sortFloor: 0.8},
	lane: {attempts: 3, onUnsure: "rebuild"},
};

/**
 * What a lane saved before the published-API check gets for added names. It
 * never compared, so there is no value it ran by; this is today's default.
 */
export const NEW_EXPORTS_BEFORE: NewExports = "problem";

/**
 * The tries a run saved before triage vetted its drafts gets. It never vetted,
 * so there is no number it ran by; this is the default it would be filed with today.
 */
export const VET_TRIES_BEFORE = 3;

const phaseOf = (part: unknown) =>
	typeof part === "object" && part !== null && "phase" in part ? part.phase : undefined;

/** A part saved before the knobs, given the ones it ran by. An idle part has none to give. */
const withKnobs = (part: unknown, knobs: object) =>
	phaseOf(part) === "idle" || (typeof part === "object" && part !== null && "knobs" in part)
		? part
		: {...(part as object), knobs};

/**
 * What a run saved before the lane kept the missing-file check's outcome gets.
 * Not `checked`: the check may have run or been skipped, and the state cannot
 * say which, so the person approving is told it is not known.
 */
const NOT_RECORDED = {kind: "not_recorded"} as const;

const fields = (part: unknown): Record<string, unknown> | null =>
	typeof part === "object" && part !== null ? (part as Record<string, unknown>) : null;

/** A lane saved before it kept the outcome: the phases and parks that carry one get {@link NOT_RECORDED}. */
function laneWithMissing(lane: unknown): unknown {
	const s = fields(lane);
	if (s === null) return lane;
	if ((s.phase === "finishing" || s.phase === "done") && !("missing" in s))
		return {...s, missing: NOT_RECORDED};
	const why = fields(s.why);
	const carries =
		why !== null && (why.kind === "comment_changes_rule" || why.kind === "tracker_failed");
	return carries && !("missing" in why) ? {...s, why: {...why, missing: NOT_RECORDED}} : lane;
}

/** A ship saved before its input kept the outcome; its record gets the line too, since that is what a person reads. */
function shipWithMissing(ship: unknown): unknown {
	const s = fields(ship);
	const input = fields(s?.input);
	if (s === null || input === null || "missing" in input || !Array.isArray(input.record))
		return ship;
	const [counts, ...rest] = input.record as unknown[];
	const record =
		counts === undefined
			? [missingLine(NOT_RECORDED)]
			: [counts, missingLine(NOT_RECORDED), ...rest];
	return {...s, input: {...input, missing: NOT_RECORDED, record}};
}

/**
 * A criterion saved before an example could import more than its own name, or
 * before an unchecked rule kept the files it is about, or what it is about.
 * Its calls used only its own name; which files the rule was about was not
 * kept, so it names none; what it was about was never said, so it is `other`.
 */
const criterionWithFiles = (criterion: unknown): unknown => {
	const c = fields(criterion);
	if (c?.kind === "example" && !("uses" in c)) return {...c, uses: []};
	if (c?.kind === "unchecked")
		return {...c, ...("files" in c ? {} : {files: []}), ...("about" in c ? {} : {about: "other"})};
	return criterion;
};

/**
 * An issue saved before it carried `openDecision`: nobody recorded a call
 * left open, so none is. Its criteria get {@link criterionWithFiles}.
 */
const withDecision = (issue: unknown): unknown => {
	const s = fields(issue);
	if (s === null) return issue;
	const criteria = Array.isArray(s.criteria) ? s.criteria.map(criterionWithFiles) : s.criteria;
	return {...s, criteria, ...("openDecision" in s ? {} : {openDecision: null})};
};

/** A part or a park, its own `issue` given `openDecision`. */
const issueIn = (part: Record<string, unknown>): Record<string, unknown> =>
	"issue" in part ? {...part, issue: withDecision(part.issue)} : part;

/**
 * What a person is asked about a run triaged when Jev still sorted who picks
 * an issue up, and sorted it for a person. Jev never said what call was open.
 */
export const SORTED_FOR_A_PERSON =
	"An older triage sorted this as needing a person's call before an agent builds it, and did not say which call. What is it?";

/** The same, for a run where Jev could not tell. It names how far Jev leaned. */
export const unsureForAPerson = (choice: unknown, confidence: unknown): string =>
	`An older triage could not tell whether this needs a person's call before an agent builds it (Jev leaned ${String(choice)}, at ${String(confidence)}). What is the call, if there is one?`;

/** A triage park saved while Jev answered the audience question: that answer is taken out. */
function whyWithoutAudience(why: Record<string, unknown>): Record<string, unknown> {
	if (why.kind === "enricher_failed" && !("note" in why)) return {...why, note: null};
	const sorted = fields(why.sorted);
	if (why.kind === "not_worth_doing" && sorted !== null && "audience" in sorted) {
		const {audience: _, ...rest} = sorted;
		return {...why, sorted: rest};
	}
	if (why.kind !== "sort_unsure" || !Array.isArray(why.answers)) return why;
	const answers = why.answers as readonly Record<string, unknown>[];
	const kept = answers.filter((a) => a.question !== "audience");
	const audience = answers.find((a) => a.question === "audience");
	if (kept.length > 0 || audience === undefined) return {...why, answers: kept};
	return {
		kind: "needs_decision",
		issue: why.issue,
		question: unsureForAPerson(audience.choice, audience.confidence),
	};
}

/**
 * A triage saved before the enricher answered whether a call is open, while
 * Jev still sorted who picks an issue up. A `triaged` issue now always means
 * an agent can build it, so one Jev sorted for a person is parked on
 * {@link SORTED_FOR_A_PERSON}; one it sorted for an agent stays triaged. A
 * park that was only unsure about the audience is parked the same way.
 */
function triageWithoutAudience(triage: unknown): unknown {
	const raw = fields(triage);
	if (raw === null) return triage;
	const s = issueIn(raw);
	if (s.phase === "enriching" && !("note" in s)) return {...s, note: null};
	if (s.phase === "triaged" && "audience" in s) {
		const {audience, type, priority, issue, ...held} = s;
		return audience === "human"
			? {
					...held,
					phase: "parked",
					why: {kind: "needs_decision", issue, question: SORTED_FOR_A_PERSON},
				}
			: {...held, issue, type, priority};
	}
	const why = fields(s.why);
	return why === null ? s : {...s, why: whyWithoutAudience(issueIn(why))};
}

/**
 * A triage saved before it gathered facts and vetted its drafts. Its knobs get
 * {@link VET_TRIES_BEFORE}; a part that holds the ticket gets `facts: null`, as
 * nothing was gathered. An enricher that was working becomes the enrichment
 * child, writing with what it was told, so a restart asks it again and vets
 * what it writes; a failed one becomes the child stopped where it failed.
 */
function triageWithVetting(triage: unknown): unknown {
	const s = fields(triage);
	if (s === null || s.phase === "idle") return triage;
	const knobs = fields(s.knobs);
	const vetted =
		knobs === null || "vetTries" in knobs
			? s
			: {...s, knobs: {...knobs, vetTries: VET_TRIES_BEFORE}};
	if (!("raw" in vetted) || "facts" in vetted) return vetted;
	const {note, ...withFacts} = {...vetted, facts: null} as Record<string, unknown>;
	const run = {
		brief: {raw: vetted.raw, facts: null},
		session: vetted.session ?? null,
		tries: 1,
		limit: (fields(withFacts.knobs)?.vetTries as number | undefined) ?? VET_TRIES_BEFORE,
	};
	if (withFacts.phase === "enriching")
		return {...withFacts, enrichment: {phase: "writing", ...run, note: note ?? null}};
	const why = fields(withFacts.why);
	if (why?.kind !== "enricher_failed" || "enrichment" in why) return withFacts;
	const {note: told, ...kind} = why;
	return {
		...withFacts,
		why: {...kind, enrichment: {phase: "write_failed", ...run, note: told ?? null}},
	};
}

/**
 * A facts pack saved before facts read the doc pages a report names: it has
 * no pages, and every name in it came from the report, so `calledIn` is `null`.
 */
function factsWithPages(facts: unknown): unknown {
	const f = fields(facts);
	if (f === null) return facts;
	const names = Array.isArray(f.names)
		? f.names.map((n) => {
				const name = fields(n);
				return name === null || "calledIn" in name ? n : {...name, calledIn: null};
			})
		: f.names;
	return {...f, names, ...("pages" in f ? {} : {pages: []})};
}

/** An enrichment run, its brief's facts brought up to date. */
const enrichmentWithPages = (enrichment: unknown): unknown => {
	const e = fields(enrichment);
	const brief = fields(e?.brief);
	return e === null || brief === null
		? enrichment
		: {...e, brief: {...brief, facts: factsWithPages(brief.facts)}};
};

/** A triage whose facts, wherever it keeps them, predate doc pages: see {@link factsWithPages}. */
function triageWithPages(triage: unknown): unknown {
	const s = fields(triage);
	if (s === null) return triage;
	const why = fields(s.why);
	return {
		...s,
		...("facts" in s ? {facts: factsWithPages(s.facts)} : {}),
		...("enrichment" in s ? {enrichment: enrichmentWithPages(s.enrichment)} : {}),
		...(why !== null && "enrichment" in why
			? {why: {...why, enrichment: enrichmentWithPages(why.enrichment)}}
			: {}),
	};
}

/** A review part, its input's issue brought up to date, and the one in the phase a park would go back to. */
function reviewWithDecision(review: unknown): unknown {
	const s = fields(review);
	const input = fields(s?.input);
	if (s === null || input === null) return review;
	const why = fields(s.why);
	const from =
		why === null || !("from" in why) ? {} : {why: {...why, from: reviewWithDecision(why.from)}};
	return {...s, input: issueIn(input), ...from};
}

/** A lane saved before issues carried `openDecision`: its issue, and the ones its review holds. */
function laneWithDecision(lane: unknown): unknown {
	const raw = fields(lane);
	if (raw === null) return lane;
	const s = issueIn(raw);
	return "review" in s ? {...s, review: reviewWithDecision(s.review)} : s;
}

/** Lane knobs saved before the published-API check, given {@link NEW_EXPORTS_BEFORE}. */
const knobsWithExports = (knobs: unknown): unknown => {
	const k = fields(knobs);
	return k === null || "newExports" in k ? knobs : {...k, newExports: NEW_EXPORTS_BEFORE};
};

/** The build-loop phases and parks a lane had before the loop was one child. */
const OLD_CHECKS = new Set(["checking", "checking_fresh", "diagnosing"]);

/**
 * A lane saved before its build loop was a draft-and-check child
 * (`src/refine.ts`). It gets what it never kept: no names the ticket named
 * (`named`; every published change then goes back unless a criterion names
 * it) and no published changes listed. A build in flight becomes the child
 * writing with the same feedback, in the same conversation; a check in
 * flight (in the folder, on a fresh copy, or a failure being read) becomes
 * the child checking the same change again from the start: the checks are
 * one step now. A park that a retry checks again holds the child stopped
 * where it stopped. The change's own summary was not kept, so it is empty.
 */
function laneWithBuildLoop(lane: unknown): unknown {
	const s = fields(lane);
	if (s === null || s.phase === "idle") return lane;
	const knobs = knobsWithExports(s.knobs);
	if ("named" in s) return {...s, knobs};
	const current = {...s, knobs, named: [], published: []} as Record<string, unknown>;
	const run = {
		brief: {issue: s.issue, session: s.session, knobs, named: []},
		session: s.session,
		tries: s.attempt,
		limit: s.limit,
	};
	const change = (deviations: unknown) => ({
		...run,
		draft: {kind: "done", summary: "", deviations: deviations ?? []},
	});
	if (s.phase === "building") {
		const {feedback, ...rest} = current;
		return {...rest, build: {phase: "writing", ...run, note: feedback ?? null}};
	}
	if (typeof s.phase === "string" && OLD_CHECKS.has(s.phase)) {
		const {deviations, seen: _seen, failure: _failure, ...rest} = current;
		return {...rest, phase: "building", build: {phase: "checking", ...change(deviations)}};
	}
	const why = fields(s.why);
	if (why?.kind === "could_not_run" && why.step !== "prepare") {
		return {
			...current,
			why: {
				kind: "could_not_run",
				step: "check",
				build: {phase: "check_failed", ...change(why.deviations)},
			},
		};
	}
	if (why?.kind === "run_failed") {
		const {deviations, ...failed} = why;
		const reason = {kind: "run_failed", step: why.step, cause: why.cause, output: why.output};
		return {...current, why: {...failed, build: {phase: "stopped", ...change(deviations), reason}}};
	}
	return current;
}

/** What the lane will start with, saved before the published-API check. */
const filedWithExports = (filed: unknown): unknown => {
	const f = fields(filed);
	return f === null ? filed : {...f, lane: knobsWithExports(f.lane)};
};

/**
 * Read a saved factory back. `null` means nothing was saved, so the run boots
 * fresh. The check is only the outline: the state was written by this machine,
 * and a shape it no longer knows is refused rather than guessed at. Three older
 * shapes are known: a factory saved before the knobs, with a `builder` and no
 * knobs, which gets {@link BEFORE_SETTINGS}; a lane or ship saved before
 * they kept the missing-file check's outcome, which gets {@link NOT_RECORDED};
 * and a run saved while Jev still sorted who picks an issue up, whose issues
 * get `openDecision: null` and whose audience answers are taken out (see
 * {@link triageWithoutAudience}). A triage saved before facts and vetting is
 * brought up to date by {@link triageWithVetting}, and a lane saved before its
 * build loop was a child by {@link laneWithBuildLoop}. Every issue's criteria
 * are brought up to date on the way, by {@link criterionWithFiles}, and every
 * facts pack by {@link factsWithPages}.
 */
export function parseFactory(raw: unknown): Migrated<Factory> {
	if (raw === null) return null;
	const saved = raw as Record<string, unknown>;
	const parts =
		typeof phaseOf(saved.triage) === "string" &&
		typeof phaseOf(saved.lane) === "string" &&
		typeof phaseOf(saved.ship) === "string";
	if (!parts) return refuse("not a saved factory");
	if ("filed" in saved) {
		return saved.filed === null || typeof saved.filed === "object"
			? ({
					...saved,
					triage: triageWithPages(triageWithVetting(triageWithoutAudience(saved.triage))),
					lane: laneWithBuildLoop(laneWithMissing(laneWithDecision(saved.lane))),
					ship: shipWithMissing(saved.ship),
					filed: filedWithExports(saved.filed),
				} as Factory)
			: refuse("not a saved factory");
	}
	const {builder} = saved;
	if (!(builder === null || typeof builder === "string")) return refuse("not a saved factory");
	return {
		triage: triageWithPages(
			triageWithVetting(triageWithoutAudience(withKnobs(saved.triage, BEFORE_SETTINGS.triage))),
		),
		lane: laneWithBuildLoop(
			laneWithMissing(laneWithDecision(withKnobs(saved.lane, BEFORE_SETTINGS.lane))),
		),
		ship: shipWithMissing(saved.ship),
		filed: builder === null ? null : {builder, lane: knobsWithExports(BEFORE_SETTINGS.lane)},
	} as Factory;
}
