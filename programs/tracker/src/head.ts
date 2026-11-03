import {Writer} from "@kampus/fabrika-old";
import {type Entry, factsOf, Id, Stage, Title} from "@kampus/pipeline/tickets/ticket";
import {Schema} from "effect";

// A ticket's top line, folded from its facts (docs/direction/what-a-ticket-shows.md, section 1).
// One of seven things, the first that fits, in this order:
//
//   done      its pull request merged after the last reopen       "done: PR #12 merged"
//             or a person closed it once its asks were answered    "done: closed after your answer"
//   closed    closed after the last reopen, and not done           "closed by owner"
//   asks      an ask is open                                       "waits on you: approve plan v2"
//   running   a run started and has not ended                      "build running, task t-2"
//   stuck     the last run answered stuck, and no ask came of it   "stuck: read failed"
//   idle      the last fact is more than an hour old               "idle since 14:02"
//   next      otherwise, from the last run's send                  "next: review"
//
//   headOf(timeline, now)   // {_tag: "asks", asks: [{ask: "a-1", what: "approve plan v2", ...}]}
//
// Pure, so the window, the list and an agent's brief read the same answer. Nobody writes "done":
// it is read off a `pr` fact that says merged, or off a person's close (section 5). An agent's
// `ended` that says done is a row, never the ticket's state. "Idle" needs the clock, so `now`
// comes in: the machine keeps it, fed each minute (./machine.ts).

/** How long a ticket waits with no new fact before its line says nobody is driving it. */
export const HOUR = 60 * 60 * 1000;

/** An ask with no answer yet: what its box shows. */
export const OpenAsk = Schema.Struct({
	ask: Id,
	what: Title,
	picks: Schema.NonEmptyArray(Title),
	by: Writer,
	/** For an agent's ask: the name its person goes by on this ledger (the entry's `whose`). */
	whose: Schema.optional(Schema.String),
	at: Schema.Finite,
});
export type OpenAsk = typeof OpenAsk.Type;

export const Head = Schema.Union([
	/** `pr`: the merged pull request's URL, or `null` for a ticket a person closed once answered. */
	Schema.TaggedStruct("done", {pr: Schema.NullOr(Schema.String)}),
	Schema.TaggedStruct("closed", {by: Writer, at: Schema.Finite}),
	Schema.TaggedStruct("asks", {asks: Schema.NonEmptyArray(OpenAsk)}),
	Schema.TaggedStruct("running", {
		run: Id,
		stage: Stage,
		task: Schema.NullOr(Id),
		since: Schema.Finite,
	}),
	Schema.TaggedStruct("stuck", {stage: Stage, why: Schema.String}),
	Schema.TaggedStruct("idle", {since: Schema.Finite}),
	/** `stage`: `triage` when no run has ended, the last run's `send`, else `null`: none was named. */
	Schema.TaggedStruct("next", {stage: Schema.NullOr(Stage)}),
]);
export type Head = typeof Head.Type;

/** The asks with no answer, oldest first. A comment never answers one; only `answered` does. */
export const openAsksOf = (timeline: readonly Entry[]): readonly OpenAsk[] => {
	const answered = new Set(factsOf(timeline, "answered").map((a) => a.ask));
	return timeline.flatMap((e) =>
		e.fact.type === "asked" && !answered.has(e.fact.ask)
			? [
					{
						ask: e.fact.ask,
						what: e.fact.what,
						picks: e.fact.picks,
						by: e.by,
						...(e.whose === undefined ? {} : {whose: e.whose}),
						at: e.at,
					},
				]
			: [],
	);
};

/** The entries since the last `reopened`: what a reopen leaves of a finished ticket. */
const sinceReopen = (timeline: readonly Entry[]): readonly Entry[] => {
	const at = timeline.findLastIndex((e) => e.fact.type === "reopened");
	return timeline.slice(at + 1);
};

/** The runs started and not ended, oldest first. */
const openRuns = (timeline: readonly Entry[]) => {
	const ended = new Set(factsOf(timeline, "ended").map((e) => e.run));
	return timeline.flatMap((e) =>
		e.fact.type === "started" && !ended.has(e.fact.run) ? [{...e.fact, at: e.at}] : [],
	);
};

/** The ticket's top line, from its facts, at `now`. */
export const headOf = (timeline: readonly Entry[], now: number): Head => {
	const fresh = sinceReopen(timeline);
	const merged = factsOf(fresh, "pr").findLast((p) => p.state === "merged");
	if (merged !== undefined) return {_tag: "done", pr: merged.url};

	const asks = openAsksOf(timeline);
	const close = fresh.findLast((e) => e.fact.type === "closed");
	if (close !== undefined) {
		const answered = factsOf(timeline, "answered").length > 0;
		return close.by.kind === "user" && answered && asks.length === 0
			? {_tag: "done", pr: null}
			: {_tag: "closed", by: close.by, at: close.at};
	}

	const [first, ...more] = asks;
	if (first !== undefined) return {_tag: "asks", asks: [first, ...more]};

	const run = openRuns(timeline).at(-1);
	if (run !== undefined)
		return {_tag: "running", run: run.run, stage: run.stage, task: run.task, since: run.at};

	const endedAt = timeline.findLastIndex((e) => e.fact.type === "ended");
	const ended = timeline[endedAt]?.fact;
	const askedSince = timeline.slice(endedAt + 1).some((e) => e.fact.type === "asked");
	if (ended?.type === "ended" && ended.outcome.kind === "stuck" && !askedSince)
		return {_tag: "stuck", stage: ended.stage, why: ended.outcome.why};

	const last = timeline.at(-1)?.at ?? now;
	if (now - last > HOUR) return {_tag: "idle", since: last};

	if (ended?.type !== "ended") return {_tag: "next", stage: "triage"};
	return {_tag: "next", stage: ended.outcome.kind === "send" ? ended.outcome.to : null};
};

/** Does the line wait on the owner: an open ask, or a stuck run. */
export const waits = (head: Head): boolean => head._tag === "asks" || head._tag === "stuck";

/** A pull request's URL as `#12`, or the URL when it names no number. */
export const prRefOf = (url: string): string => {
	const n = /\/pull\/(\d+)\/?$/.exec(url)?.[1];
	return n === undefined ? url : `#${n}`;
};

/** A word with its underscores as spaces: `read_failed` reads `read failed`. */
export const words = (word: string): string => word.replaceAll("_", " ");

/** The line in words. `when`: a time in a few words, as the window says it. */
export const lineOf = (head: Head, when: (at: number) => string): string => {
	switch (head._tag) {
		case "done":
			return head.pr === null
				? "done: closed after your answer"
				: `done: PR ${prRefOf(head.pr)} merged`;
		case "closed":
			return head.by.kind === "user" ? `closed by ${head.by.id}` : `closed by agent ${head.by.id}`;
		case "asks": {
			const [only, ...more] = head.asks;
			return more.length === 0
				? `waits on you: ${only.what}`
				: `waits on you: ${head.asks.length} asks`;
		}
		case "running":
			return head.task === null
				? `${head.stage} running`
				: `${head.stage} running, task ${head.task}`;
		case "stuck":
			return `stuck: ${words(head.why)}`;
		case "idle":
			return `idle since ${when(head.since)}`;
		case "next":
			return head.stage === null ? "next: not named" : `next: ${head.stage}`;
	}
};
