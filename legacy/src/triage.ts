import {applyCell, defineMachine} from "@demlik/tea";
import {
	createRefine,
	type RefineAnswer,
	type RefineMsg,
	type RefineState,
} from "@kampus/fabrika/pipeline/refine";
import {z} from "zod";
import {
	asksTheCode,
	FactsPack,
	gatherFacts,
	type Mentions,
	mentionsOf,
	nothingToAsk,
} from "./facts.ts";
import {Issue, RawIssue} from "./issue.ts";
import {
	type KillClause,
	SORT_KEY,
	type SortCmd,
	type Sorted,
	type SortState,
	type SortTimerMsg,
	sortAsk,
	sortContent,
	sortRulingOf,
	type UnsureSort,
} from "./sort.ts";
import {fetchTicket} from "./tracker.ts";
import {Vetted, vetProblems} from "./vetting.ts";

// Triage, as small parts each owned by what does it best:
//
//   code     what the report mentions, and what the repo says about it (facts);
//            whether a draft's files exist and its examples run as they should
//            on today's code (vetting); the routing between all of them
//   agent    the rewrite itself: a plain-words body, the criteria, the call
//            nobody has made. It starts from the facts, and ends in typed data
//   Jev      sorting the rewrite: type, priority, worth doing
//   person   the call nobody has made, and a draft vetting still rejects after
//            its tries
//
// The rewrite and its vetting are one draft-and-vet child (`src/refine.ts`):
// vetting's problems go back to the enricher in its own conversation.

/** What the enricher works from: the ticket as filed, and what code found about it (`null` when it could not look). */
export const EnrichBrief = z.object({raw: RawIssue, facts: FactsPack.nullable()});
export type EnrichBrief = z.infer<typeof EnrichBrief>;

/**
 * The enricher drafts the rewrite and the workspace vets it, as one
 * draft-and-vet loop: Cmds `enrich_write` and `enrich_check`. The verdict is
 * what the run saw; what is wrong with the draft is {@link vetProblems}, pure.
 */
export const enrichment = createRefine({
	name: "enrich",
	brief: EnrichBrief,
	draft: Issue,
	verdict: Vetted,
	problemsOf: vetProblems,
});

/** The enrichment child's state, as triage holds it. */
export type Enrichment = RefineState<EnrichBrief, Issue, Vetted>;
type EnrichmentCmd = ReturnType<typeof enrichment.write> | ReturnType<typeof enrichment.check>;

/** Why triage stopped and is waiting on a person. Each carries what its answer needs. */
export type TriagePark =
	/** The ticket could not be read from the tracker. Nothing else is known yet. */
	| {readonly kind: "tracker_failed"}
	/** The enricher's turn failed. `enrichment` holds what it was told, so a retry tells it again. */
	| {readonly kind: "enricher_failed"; readonly enrichment: Enrichment}
	/** The draft could not be vetted: the copy, its install or the test runner failed. */
	| {readonly kind: "vetting_failed"; readonly issue: Issue; readonly enrichment: Enrichment}
	/** The enricher's last draft still fails vetting, and its tries are spent. `problems` are vetting's last word. */
	| {
			readonly kind: "enrichment_unvetted";
			readonly issue: Issue;
			readonly problems: readonly string[];
			readonly enrichment: Enrichment;
	  }
	/**
	 * The enricher says the issue rests on a call nobody has made yet. Jev is
	 * not asked: nothing is sorted, let alone built, until the owner makes it.
	 */
	| {readonly kind: "needs_decision"; readonly issue: Issue; readonly question: string}
	| {readonly kind: "sort_failed"; readonly issue: Issue}
	| {readonly kind: "sort_unsure"; readonly issue: Issue; readonly answers: readonly UnsureSort[]}
	/** A person filed it and it fails the value bar. A person's filing is never thrown away. */
	| {
			readonly kind: "not_worth_doing";
			readonly issue: Issue;
			readonly clause: KillClause;
			readonly sorted: Omit<Sorted, "value">;
	  };

type Drop = {readonly kind: "drop"};

/** What a person may answer to each of triage's parks. Any other answer leaves it parked. */
export interface TriageParkAnswers {
	readonly tracker_failed: {readonly kind: "retry"} | Drop;
	readonly enricher_failed: {readonly kind: "retry"} | Drop;
	/** `retry`: vet the same draft again. `accept`: take it unvetted. */
	readonly vetting_failed: {readonly kind: "retry"} | {readonly kind: "accept"} | Drop;
	/**
	 * `retry`: `tries` more drafts, in the same conversation, starting from
	 * vetting's last problems. `accept`: take the last draft as it is.
	 */
	readonly enrichment_unvetted:
		| {readonly kind: "retry"; readonly tries: number}
		| {readonly kind: "accept"}
		| Drop;
	/** `decide`: the owner's ruling goes back to the enricher, in the same conversation, and triage carries on from its rewrite. */
	readonly needs_decision: {readonly kind: "decide"; readonly ruling: string} | Drop;
	readonly sort_failed: {readonly kind: "retry"} | Drop;
	/** `sort`: the person sorts it. Answering at all means it is worth doing. */
	readonly sort_unsure: ({readonly kind: "sort"} & Omit<Sorted, "value">) | Drop;
	/** `keep`: worth doing after all, sorted as Jev sorted it. */
	readonly not_worth_doing: {readonly kind: "keep"} | Drop;
}

/** An answer to one kind of triage park, tagged with the park it answers. */
export type TriageParkAnswer = {
	[K in keyof TriageParkAnswers]: {readonly park: K; readonly answer: TriageParkAnswers[K]};
}[keyof TriageParkAnswers];

/**
 * What triage takes from `fabrika.toml`, copied in when a ticket is filed and
 * kept in the state, so a restart sorts and vets by the numbers the run started with.
 */
export interface TriageKnobs {
	/** Below this, triage does not take Jev's word on a sort. */
	readonly sortFloor: number;
	/** How many drafts the enricher gets to pass vetting before a person is asked. */
	readonly vetTries: number;
}

type Knobbed = {readonly knobs: TriageKnobs};

type Held = Knobbed & {
	readonly raw: RawIssue;
	/** The enricher's conversation, once it has had one. */
	readonly session: string | null;
	/** What code found about the report; `null` when it could not look, or the run predates facts. */
	readonly facts: FactsPack | null;
};

/** A ticket known only by its id: before the tracker has handed it over. */
type Unread = Knobbed & {readonly id: string};

type EnrichmentPark = Extract<
	TriagePark,
	{kind: "enricher_failed" | "vetting_failed" | "enrichment_unvetted"}
>;

export type Triage =
	| {readonly phase: "idle"}
	| (Unread & {readonly phase: "fetching"})
	| (Unread & {readonly phase: "parked"; readonly why: {readonly kind: "tracker_failed"}})
	| (Unread & {readonly phase: "dropped"; readonly why: {readonly kind: "tracker_failed"}})
	/** Asking the code about what the report mentions. */
	| (Knobbed & {readonly phase: "gathering"; readonly raw: RawIssue; readonly mentions: Mentions})
	/** The enricher drafts and vetting checks, in the child it holds. */
	| (Held & {readonly phase: "enriching"; readonly enrichment: Enrichment})
	| (Held & {
			readonly phase: "sorting";
			readonly issue: Issue;
			readonly sort: SortState;
	  })
	/** Ready for an agent: no call left open, and sorted. Whether a lane can build its type is the factory's to check. */
	| (Held & {readonly phase: "triaged"; readonly issue: Issue} & Omit<Sorted, "value">)
	| (Held & {readonly phase: "parked"; readonly why: Exclude<TriagePark, {kind: "tracker_failed"}>})
	| (Held & {
			readonly phase: "dropped";
			readonly why: Exclude<TriagePark, {kind: "tracker_failed"}>;
	  })
	| (Held & {readonly phase: "killed"; readonly clause: KillClause});

/** A draft the enrichment child holds, if it holds one. */
const draftIn = (e: Enrichment): Issue | null => ("draft" in e ? e.draft : null);

/** The enricher's rewrite, where the state still holds one: the last draft while it is vetted. A killed run, and one never enriched, hold none. */
export function rewriteOf(s: Triage): Issue | null {
	if ("issue" in s) return s.issue;
	if (s.phase === "enriching") return draftIn(s.enrichment);
	if ((s.phase === "parked" || s.phase === "dropped") && "issue" in s.why) return s.why.issue;
	return null;
}

export type TriageMsg =
	/**
	 * A ticket was filed. Only its id comes in: the ticket itself is read from
	 * the tracker. `knobs` come from the settings; the host reads them, so the reducer stays pure.
	 */
	| {readonly type: "file"; readonly issue: string; readonly knobs: TriageKnobs}
	/** Sent once after booting from saved state: re-issue whatever was in flight. */
	| {readonly type: "resume"; readonly at: number}
	| {readonly type: "answer"; readonly answer: TriageParkAnswer; readonly at: number}
	| SortTimerMsg;

export type TriageCmd =
	| ReturnType<typeof fetchTicket>
	| ReturnType<typeof gatherFacts>
	| EnrichmentCmd
	| SortCmd;

type Step = readonly [Triage, readonly TriageCmd[]];
type Sorting = Extract<Triage, {phase: "sorting"}>;
type AnyMsg = {readonly type: string};

const stay = (s: Triage): Step => [s, []];
const held = (s: Held): Held => ({raw: s.raw, session: s.session, facts: s.facts, knobs: s.knobs});
const park = (s: Held, why: Exclude<TriagePark, {kind: "tracker_failed"}>): Step => [
	{phase: "parked", ...held(s), why},
	[],
];

/** Put the sorter's slice back, and leave triage once Jev has answered. */
function settleSort(s: Sorting, [sort, cmds]: readonly [SortState, readonly SortCmd[]]): Step {
	const ruling = sortRulingOf(sort, s.knobs.sortFloor);
	if (ruling === null) return [{...s, sort}, cmds];
	switch (ruling.kind) {
		case "failed":
			return park(s, {kind: "sort_failed", issue: s.issue});
		case "unsure":
			return park(s, {kind: "sort_unsure", issue: s.issue, answers: ruling.answers});
		case "sorted": {
			const sorted = {type: ruling.type, priority: ruling.priority};
			if (ruling.value !== "keep") {
				return s.raw.filedBy === "agent"
					? [{phase: "killed", ...held(s), clause: ruling.value}, []]
					: park(s, {kind: "not_worth_doing", issue: s.issue, clause: ruling.value, sorted});
			}
			return triaged(s, s.issue, sorted);
		}
	}
}

const triaged = (s: Held, issue: Issue, sorted: Omit<Sorted, "value">): Step => [
	{phase: "triaged", ...held(s), issue, ...sorted},
	[],
];

/** Ask Jev to sort `issue`, from a fresh slice. */
function startSorting(s: Held, issue: Issue, at: number): Step {
	const [sort, cmds] = sortAsk.attempt(sortAsk.init(), SORT_KEY, sortContent(issue), at);
	return [{phase: "sorting", ...held(s), issue, sort}, cmds];
}

/**
 * The rewrite passed vetting, or a person took it. A call it says nobody has
 * made goes to the owner before Jev is asked anything; otherwise Jev sorts it.
 */
const enriched = (s: Held, issue: Issue, at: number): Step =>
	issue.openDecision === null
		? startSorting(s, issue, at)
		: park(s, {kind: "needs_decision", issue, question: issue.openDecision});

/**
 * Read the enrichment child after a step: done goes on with its draft, a
 * stopped child parks triage for a person, and anything else keeps enriching.
 * The enricher's conversation is kept on triage as soon as the child knows it.
 */
function settleEnrichment(
	s: Held,
	child: Enrichment,
	cmds: readonly EnrichmentCmd[],
	at: number,
): Step {
	const next: Held = {
		...held(s),
		session: "session" in child && child.session !== null ? child.session : s.session,
	};
	switch (child.phase) {
		case "done":
			return enriched(next, child.draft, at);
		case "write_failed":
			return park(next, {kind: "enricher_failed", enrichment: child});
		case "check_failed":
			return park(next, {kind: "vetting_failed", issue: child.draft, enrichment: child});
		case "out_of_tries":
			return park(next, {
				kind: "enrichment_unvetted",
				issue: child.draft,
				problems: child.problems,
				enrichment: child,
			});
		default:
			return [{phase: "enriching", ...next, enrichment: child}, cmds];
	}
}

/** Step the enrichment child with `msg`, and read it after. */
function toEnrichment(s: Held, child: Enrichment, msg: AnyMsg, at: number): Step {
	const [next, cmds] = applyCell<Enrichment, AnyMsg, EnrichmentCmd>(enrichment.machine, child, msg);
	return settleEnrichment(s, next, cmds, at);
}

/** Start a draft-and-vet run: the first rewrite, or a new one after the owner's ruling. */
function startEnriching(s: Held, note: string | null, at: number): Step {
	const start: RefineMsg<EnrichBrief> = {
		type: "start",
		brief: {raw: s.raw, facts: s.facts},
		session: s.session,
		note,
		limit: s.knobs.vetTries,
	};
	return toEnrichment(s, {phase: "idle"}, start, at);
}

/** What the enricher is told once the owner has made the call its rewrite was waiting on. */
export const rulingNote = (question: string, ruling: string): string =>
	`The owner decided the open question.\nQuestion: ${question}\nRuling: ${ruling}\nRewrite the issue with that settled.`;

type Parked = Extract<Triage, {phase: "parked"}>;

const startFetching = (id: string, knobs: TriageKnobs): Step => [
	{phase: "fetching", id, knobs},
	[fetchTicket({issue: id})],
];

/**
 * The ticket is in: ask the code about what it mentions, unless it mentions
 * nothing the code could answer, when the enricher starts at once.
 */
function fetched(raw: RawIssue, knobs: TriageKnobs, at: number): Step {
	const mentions = mentionsOf(`${raw.title}\n\n${raw.body}`);
	if (!asksTheCode(mentions))
		return startEnriching({raw, session: null, facts: nothingToAsk(mentions), knobs}, null, at);
	return [{phase: "gathering", raw, mentions, knobs}, [gatherFacts({mentions})]];
}

/** What a person's answer to an enrichment park asks of the child. `null`: nothing it can act on. */
function enrichmentAnswer(
	why: EnrichmentPark,
	answer: TriageParkAnswer["answer"],
): RefineAnswer | null {
	switch (why.kind) {
		case "enricher_failed":
			return answer.kind === "retry" ? {kind: "retry"} : null;
		case "vetting_failed":
			return answer.kind === "retry"
				? {kind: "retry"}
				: answer.kind === "accept"
					? {kind: "accept"}
					: null;
		case "enrichment_unvetted":
			if (answer.kind === "accept") return {kind: "accept"};
			return answer.kind === "retry" && "tries" in answer && answer.tries >= 1
				? {kind: "more", tries: answer.tries}
				: null;
	}
}

/** A person's answer to the park triage is in. Any other answer changes nothing. */
function answerPark(s: Parked, {park: kind, answer}: TriageParkAnswer, at: number): Step {
	if (kind !== s.why.kind) return stay(s);
	// Before the ticket was read there is nothing but its id.
	if (!("raw" in s))
		return answer.kind === "drop" ? [{...s, phase: "dropped"}, []] : startFetching(s.id, s.knobs);
	if (answer.kind === "drop") return [{...s, phase: "dropped"}, []];
	switch (s.why.kind) {
		case "enricher_failed":
		case "vetting_failed":
		case "enrichment_unvetted": {
			const asked = enrichmentAnswer(s.why, answer);
			if (asked === null) return stay(s);
			const msg: RefineMsg<EnrichBrief> = {type: "answer", answer: asked};
			return toEnrichment(s, s.why.enrichment, msg, at);
		}
		case "needs_decision":
			return answer.kind === "decide"
				? startEnriching(s, rulingNote(s.why.question, answer.ruling), at)
				: stay(s);
		case "sort_failed":
			return startSorting(s, s.why.issue, at);
		case "sort_unsure":
			return answer.kind === "sort"
				? triaged(s, s.why.issue, {type: answer.type, priority: answer.priority})
				: stay(s);
		case "not_worth_doing":
			return triaged(s, s.why.issue, s.why.sorted);
	}
}

/**
 * Re-issue what triage booted from saved state was waiting on. An enricher
 * killed before its first answer starts a new conversation: its id is only
 * known once it answers.
 */
function resume(s: Triage, at: number): Step {
	switch (s.phase) {
		case "fetching":
			return startFetching(s.id, s.knobs);
		case "gathering":
			return [s, [gatherFacts({mentions: s.mentions})]];
		case "enriching":
			return toEnrichment(s, s.enrichment, {type: "resume"}, at);
		case "sorting": {
			if (s.sort.calls[SORT_KEY]?.phase !== "running") return stay(s);
			const [sort, cmds] = sortAsk.attempt(s.sort, SORT_KEY, sortContent(s.issue), at);
			return [{...s, sort}, cmds];
		}
		default:
			return stay(s);
	}
}

/** An enrichment Msg goes to the child while triage enriches; anywhere else it is late, and changes nothing. */
const enrichmentCell = (s: Triage, m: AnyMsg & {readonly at: number}): Step =>
	s.phase === "enriching" ? toEnrichment(s, s.enrichment, m, m.at) : stay(s);

/**
 * One raw issue, from "file" to triaged, parked or killed. Code reads what
 * the report mentions and asks the repo about it; the enricher rewrites it
 * from those facts, and code vets each draft by running its examples on
 * today's code, sending problems back in the same conversation. A rewrite
 * that rests on a call nobody has made waits for the owner. Then Jev sorts
 * it: its type, its priority, and whether it is worth doing at all.
 */
export const triage = defineMachine({
	types: {model: {} as Triage, msg: {} as TriageMsg, ctx: undefined},
	cmds: [fetchTicket, gatherFacts, enrichment.write, enrichment.check, sortAsk.run],
	init: (loaded) => [loaded ?? {phase: "idle"}, []],
	update: {
		file: (s, m): Step => (s.phase === "idle" ? startFetching(m.issue, m.knobs) : stay(s)),
		fetch_ticket_ok: (s, m): Step =>
			s.phase === "fetching" ? fetched(m.value, s.knobs, m.at) : stay(s),
		fetch_ticket_err: (s): Step =>
			s.phase === "fetching"
				? [{phase: "parked", id: s.id, knobs: s.knobs, why: {kind: "tracker_failed"}}, []]
				: stay(s),
		// Facts only help: without them the enricher reads the code itself, as it did before there were any.
		gather_facts_ok: (s, m): Step =>
			s.phase === "gathering"
				? startEnriching({raw: s.raw, session: null, facts: m.value, knobs: s.knobs}, null, m.at)
				: stay(s),
		gather_facts_err: (s, m): Step =>
			s.phase === "gathering"
				? startEnriching({raw: s.raw, session: null, facts: null, knobs: s.knobs}, null, m.at)
				: stay(s),
		resume: (s, m): Step => resume(s, m.at),
		answer: (s, m): Step => (s.phase === "parked" ? answerPark(s, m.answer, m.at) : stay(s)),
		enrich_write_ok: enrichmentCell,
		enrich_write_err: enrichmentCell,
		enrich_check_ok: enrichmentCell,
		enrich_check_err: enrichmentCell,
		sort_run_ok: (s, m): Step =>
			s.phase === "sorting" ? settleSort(s, sortAsk.succeed(s.sort, m)) : stay(s),
		sort_run_err: (s, m): Step =>
			s.phase === "sorting" ? settleSort(s, sortAsk.fail(s.sort, m)) : stay(s),
		sort_deadline: (s, m): Step =>
			s.phase === "sorting" ? settleSort(s, sortAsk.onTimer(s.sort, m)) : stay(s),
	},
	subs: [
		{
			type: "timer",
			deps: (s: Triage) => (s.phase === "sorting" ? sortAsk.timer(s.sort) : null),
		},
	],
});
