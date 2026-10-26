import {type Writer, writerOf} from "@kampus/fabrika";
import {Schema} from "effect";
import {type Gate, park, pass} from "./combos.ts";

// Rate: count the "fix" and "noise" ratings on a rule's findings, and say
// whether the rule may block or only advise
// (docs/direction/new-combos.md, "Rate"). Plain data and pure functions, like
// the combos in src/combos.ts: a parent gathers the findings and the ratings,
// and calls these from its own update.
//
//   tallyOf(findings, facts, (rule) => silence)   {scope: {fix: 4, noise: 1, open: 2}}
//   modeOf(tally.scope, enough)                   "advise": one noise is too many to block
//   gateRate(found, (rule) => mode)               parks on the findings of a rule that blocks
//
// How one finding counts is decided (docs/direction/every-finding-is-rated.md):
//
//   rated "fix"                  fix
//   rated "noise"                noise
//   never rated, change shipped  what the rule's `Silence` says: noise for a
//                                check's finding (seen, never acted on), not
//                                counted yet for a call like the test writer's
//   never rated, still open      not counted yet
//
// Only a user's rating counts, and who wrote a rating is the writer of the
// ledger row that holds it, never what the rating says about itself. A
// rating in a row an agent wrote, or one whose writer names neither a user
// nor an agent, is left out: as if never rated.
//
// The finding's own shape (SARIF's `result`) is only proposed, so a finding
// here is the least the count needs: its id and its rule.

/** A finding, as the count sees it: which one, and which rule made it. */
export const Finding = Schema.Struct({id: Schema.String, rule: Schema.String});
export type Finding = typeof Finding.Type;

/** What a rating says: the finding was worth fixing, or it was noise. */
export const Says = Schema.Literals(["fix", "noise"]);
export type Says = typeof Says.Type;

/**
 * One click on one finding, as a fact of its own. It does not say who
 * clicked: the writer of its row does. "Counts as noise" is worked out when
 * the count is made; nothing is ever written for it.
 */
export const Rating = Schema.Struct({finding: Schema.String, says: Says});
export type Rating = typeof Rating.Type;

/** A rating as the ledger holds it: the row's `writer` text, and the rating it holds. */
export const RatingRow = Schema.Struct({writer: Schema.String, rating: Rating});
export type RatingRow = typeof RatingRow.Type;

/** What the count reads: every rating row in the order it was written, and the findings whose change shipped. */
export const Facts = Schema.Struct({
	ratings: Schema.Array(RatingRow),
	shipped: Schema.Array(Schema.String),
});
export type Facts = typeof Facts.Type;

type User = Extract<Writer, {readonly kind: "user"}>;

/** A rating whose row a user wrote: the only kind the count reads. */
export interface UserRating {
	readonly by: User;
	readonly rating: Rating;
}

/** The ratings users wrote, in order. A row an agent wrote, or one whose writer names neither, is left out. */
export const userRatings = (facts: Facts): readonly UserRating[] =>
	facts.ratings.flatMap(({writer, rating}) => {
		const by = writerOf(writer);
		return by?.kind === "user" ? [{by, rating}] : [];
	});

/**
 * What a finding never rated counts as once its change ships. Each use of
 * Rate says it for its rule; there is no default.
 *
 *   "noise"  a check's finding: the owner saw it and did not act
 *   "open"   a call the owner must make, such as the test writer's `noise`
 *            answer (docs/direction/the-test-writer.md): silence is not the
 *            owner agreeing, so it stays not counted, shipped or not
 */
export const Silence = Schema.Literals(["noise", "open"]);
export type Silence = typeof Silence.Type;

/** How one finding counts, from users' ratings only. */
function count(
	finding: Finding,
	rated: readonly UserRating[],
	shipped: readonly string[],
	silence: Silence,
): Says | null {
	// A person may change their mind: the last rating holds.
	const last = rated.findLast((r) => r.rating.finding === finding.id);
	if (last !== undefined) return last.rating.says;
	return silence === "noise" && shipped.includes(finding.id) ? "noise" : null;
}

/** How one finding counts now: its user's rating, what `silence` says once shipped unrated, or `null`: not yet. */
export const countedAs = (finding: Finding, facts: Facts, silence: Silence): Says | null =>
	count(finding, userRatings(facts), facts.shipped, silence);

/** One rule's count. `open`: findings not counted yet. */
export interface Tally {
	readonly fix: number;
	readonly noise: number;
	readonly open: number;
}

export const none: Tally = {fix: 0, noise: 0, open: 0};

/**
 * The count for each rule that has findings, from users' ratings only, with
 * what silence means for each rule. A finding listed twice counts once.
 *
 * A rule's name is the check's own word, so it may be `constructor` or
 * `__proto__`: the count is kept in a Map, and the record it hands back has
 * each rule as an own key, plain data a parent can keep in its state.
 */
export function tallyOf(
	findings: readonly Finding[],
	facts: Facts,
	silence: (rule: string) => Silence,
): Readonly<Record<string, Tally>> {
	const seen = new Map(findings.map((f) => [f.id, f]));
	const rated = userRatings(facts);
	const tally = new Map<string, Tally>();
	for (const finding of seen.values()) {
		const t = tally.get(finding.rule) ?? none;
		const counted = count(finding, rated, facts.shipped, silence(finding.rule));
		tally.set(
			finding.rule,
			counted === null ? {...t, open: t.open + 1} : {...t, [counted]: t[counted] + 1},
		);
	}
	return Object.fromEntries(tally);
}

/**
 * How many counted ratings a rule needs before it may block. Still open
 * (docs/direction/every-finding-is-rated.md, "Still open"), so no number is
 * set here: it comes from the settings, and the type asks for a whole number
 * of at least 1, since a rule nobody rated has shown nothing.
 */
export const Enough = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)).pipe(
	Schema.brand("Enough"),
);
export type Enough = typeof Enough.Type;

/** A rule's mode: its findings only advise, or they stop the work. */
export type Mode = "advise" | "block";

/**
 * Block only with `enough` counted findings and no noise among them, the way
 * Google holds a check that stops the build to "no effective false
 * positives" (Sadowski et al., CACM 2018). Not yet counted is not evidence.
 */
export const modeOf = (tally: Tally, enough: Enough): Mode =>
	tally.fix + tally.noise >= enough && tally.noise === 0 ? "block" : "advise";

/**
 * Gate on Rate: the findings of a rule that blocks park the work, all of them
 * together; a rule that only advises lets it pass, its findings left for the
 * user to rate.
 */
export function gateRate(
	found: readonly Finding[],
	mode: (rule: string) => Mode,
): Gate<readonly [Finding, ...Finding[]]> {
	const [first, ...rest] = found.filter((f) => mode(f.rule) === "block");
	return first === undefined ? pass : park([first, ...rest]);
}
