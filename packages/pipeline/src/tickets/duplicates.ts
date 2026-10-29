import {DEFAULT_JEV_MODEL} from "@demlik/tea/jev";
import {Effect, Schema} from "effect";
import {createYesNoJudge} from "../primitives.ts";
import {Body, type Ticket, TicketNumber, Title, Yes} from "./ticket.ts";

// A duplicate hint when a ticket is filed: "maybe the same as #4", with accept and dismiss, the
// way Linear and GitHub say it. Advice only: it never closes, merges or hides a ticket
// (docs/direction/jev-same-answer-cheaper.md; experiments 37 and 167).
//
//   candidatesOf(filed, open)          code: the open tickets that share a rare word with it
//   scoresOf(filed, candidates)        Jev: one yes-or-no per candidate, "could the new one be
//                                      closed and #N worked without losing anything?"
//   hintsOf(scores)                    code: at or above the floor, the best first, at most three
//
//   hintsOf([{of: 4, yes: 0.83}, {of: 6, yes: 0.12}])   // [{of: 4, yes: 0.83}]
//
// Jev reads; code picks who it reads and ranks what comes back. The facts it leaves on the new
// ticket are `maybe_duplicate` (code's) and `duplicate_rated` (a person's), in ./ticket.ts.

/** A ticket as the hint reads it: its number, title and body. */
export const Candidate = Schema.Struct({number: TicketNumber, title: Title, body: Body});
export type Candidate = typeof Candidate.Type;

/** One candidate's answer: how sure Jev is that the new ticket is a duplicate of `of`. */
export const Scored = Schema.Struct({of: TicketNumber, yes: Yes});
export type Scored = typeof Scored.Type;

/**
 * The floor a hint must reach. Experiment 37 picked 0.7 on 30 duplicate pairs and 105 controls
 * of another repo. Experiment 167 kept it on this tracker's own tickets: at 0.7, 24 of 25 true
 * pairs got a hint, and 1 of 1,613 other pairs did; at 0.8 none did, but the one real duplicate
 * (0.78) was missed too.
 */
export const FLOOR = 0.7;

/** The most hints one ticket gets. */
export const TOP = 3;

/** The most candidates Jev reads for one filing: the cheap filter's cut. */
export const MAX_CANDIDATES = 20;

/** How much of a body Jev reads: the problem is stated first (experiment 37). */
export const BODY_CHARS = 3_000;

/** At most this many Jev calls at once for one filing. */
const POOL = 8;

/** A ticket's body: the one it was filed with. */
export const bodyOf = (ticket: Ticket): string => {
	const first = ticket.timeline[0]?.fact;
	return first?.type === "filed" ? first.body : "";
};

/** The open tickets of a list as candidates, `except` the one just filed. */
export const openOf = (tickets: readonly Ticket[], except: number): readonly Candidate[] =>
	tickets
		.filter((t) => t.state === "open" && t.number !== except)
		.map((t) => ({number: t.number, title: t.title, body: bodyOf(t)}));

/** Words too common to say two tickets are about the same thing. */
const COMMON = new Set(
	`about after again also because been before being both does done each even every first from
	have here into just like made make many more most much must need needs only other over same
	should show shows some still such than that their them then there these they this those ticket
	tickets through very want were what when where which while will with without would your`.split(
		/\s+/,
	),
);

/** A text's words, for the filter: letters and digits, four or more, lower case, no plural `s`. */
export const wordsOf = (text: string): ReadonlySet<string> =>
	new Set(
		(text.toLowerCase().match(/[a-z][a-z0-9]{3,}/g) ?? [])
			.filter((w) => !COMMON.has(w))
			.map((w) => (w.length > 4 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w)),
	);

const wordsOfTicket = (t: {readonly title: string; readonly body: string}) =>
	wordsOf(`${t.title}\n${t.body.slice(0, BODY_CHARS)}`);

/**
 * The cheap filter, with no Jev call: the open tickets that share a word with the new one, the
 * rarest shared words first. Each shared word counts by how rare it is among the open tickets
 * (its inverse document frequency), so "login" counts for more than "tracker". Ties go to the
 * newer ticket. At most `max`.
 */
export const candidatesOf = (
	filed: {readonly title: string; readonly body: string},
	open: readonly Candidate[],
	max: number = MAX_CANDIDATES,
): readonly Candidate[] => {
	const mine = wordsOfTicket(filed);
	const theirs = open.map((c) => ({c, words: wordsOfTicket(c)}));
	const df = new Map<string, number>();
	for (const {words} of theirs) for (const w of words) df.set(w, (df.get(w) ?? 0) + 1);
	const rarity = (w: string) => Math.log((open.length + 1) / (df.get(w) ?? 1));
	return theirs
		.map(({c, words}) => ({
			c,
			score: [...mine].filter((w) => words.has(w)).reduce((n, w) => n + rarity(w), 0),
		}))
		.filter((x) => x.score > 0)
		.sort((a, b) => b.score - a.score || b.c.number - a.c.number)
		.slice(0, max)
		.map((x) => x.c);
};

/** The question, as experiment 37 asked it, with "ticket" for "issue". */
export const duplicateJudge = createYesNoJudge({
	name: "duplicate",
	instructions:
		"`new` is a ticket just filed. `existing` is a ticket that is already open. Each is its title, then its body. Is `new` a duplicate of `existing`: could `new` be closed, and `existing` worked, without losing anything `new` asks for?",
	criteria: {
		true: "The same problem or request: working `existing` also does what `new` asks, even if `existing` asks for more",
		false:
			"A different problem or request, even about the same file, feature or subject; or `new` asks for something `existing` does not cover",
	},
});

/** A ticket as Jev reads it: the title, a blank line, and the start of the body. */
export const textOf = (t: {readonly title: string; readonly body: string}): string =>
	t.body === "" ? t.title : `${t.title}\n\n${t.body.slice(0, BODY_CHARS)}`;

/**
 * Ask Jev about each candidate, at most `POOL` at once. One call that fails fails them all, so a
 * hint is never ranked from part of the candidates.
 */
export const scoresOf = (
	filed: {readonly title: string; readonly body: string},
	candidates: readonly Candidate[],
	model: string = DEFAULT_JEV_MODEL,
) =>
	Effect.forEach(
		candidates,
		(c) =>
			duplicateJudge
				.judge(model, {new: textOf(filed), existing: textOf(c)})
				.pipe(Effect.map(({yes}): Scored => ({of: c.number, yes}))),
		{concurrency: POOL},
	);

/** The hints: at or above the floor, the surest first, at most `top`. */
export const hintsOf = (
	scores: readonly Scored[],
	floor: number = FLOOR,
	top: number = TOP,
): readonly Scored[] =>
	scores
		.filter((s) => s.yes >= floor)
		.toSorted((a, b) => b.yes - a.yes || a.of - b.of)
		.slice(0, top);
