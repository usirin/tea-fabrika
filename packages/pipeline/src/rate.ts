import {Schema} from "effect";
import {type Gate, park, pass} from "./combos.ts";

// Rate: count the "fix" and "noise" ratings on a rule's findings, and say
// whether the rule may block or only advise
// (docs/direction/new-combos.md, "Rate"). Plain data and pure functions, like
// the combos in src/combos.ts: a parent gathers the findings and the ratings,
// and calls these from its own update.
//
//   tallyOf(findings, facts)            {scope: {fix: 4, noise: 1, open: 2}}
//   modeOf(tally.scope, enough)         "advise": one noise is too many to block
//   gateRate(found, (rule) => mode)     parks on the findings of a rule that blocks
//
// How one finding counts is decided (docs/direction/every-finding-is-rated.md):
//
//   rated "fix"                  fix
//   rated "noise"                noise
//   never rated, change shipped  noise: seen, never acted on
//   never rated, still open      not counted yet
//
// The finding's own shape (SARIF's `result`) is only proposed, so a finding
// here is the least the count needs: its id and its rule.

/** A finding, as the count sees it: which one, and which rule made it. */
export const Finding = Schema.Struct({id: Schema.String, rule: Schema.String});
export type Finding = typeof Finding.Type;

/**
 * Who may rate: people only. An agent's role ("review", "plan") is not on
 * the list, so a rating by an agent does not type. "Counts as noise" is
 * worked out when the count is made; nothing is ever written for it.
 */
export const RATERS = ["owner"] as const;
export const Rater = Schema.Literals(RATERS);
export type Rater = typeof Rater.Type;

/** What a rating says: the finding was worth fixing, or it was noise. */
export const Says = Schema.Literals(["fix", "noise"]);
export type Says = typeof Says.Type;

/** One click on one finding, as a fact of its own. */
export const Rating = Schema.Struct({finding: Schema.String, by: Rater, says: Says});
export type Rating = typeof Rating.Type;

/** What the count reads: every rating in the order it was made, and the findings whose change shipped. */
export const Facts = Schema.Struct({
	ratings: Schema.Array(Rating),
	shipped: Schema.Array(Schema.String),
});
export type Facts = typeof Facts.Type;

/** How one finding counts now: its rating, noise once shipped unrated, or `null`: not yet. */
export function countedAs(finding: Finding, facts: Facts): Says | null {
	// A person may change their mind: the last rating holds.
	const rated = facts.ratings.findLast((r) => r.finding === finding.id);
	if (rated !== undefined) return rated.says;
	return facts.shipped.includes(finding.id) ? "noise" : null;
}

/** One rule's count. `open`: findings not counted yet. */
export interface Tally {
	readonly fix: number;
	readonly noise: number;
	readonly open: number;
}

export const none: Tally = {fix: 0, noise: 0, open: 0};

/** The count for each rule that has findings. A finding listed twice counts once. */
export function tallyOf(
	findings: readonly Finding[],
	facts: Facts,
): Readonly<Record<string, Tally>> {
	const seen = new Map(findings.map((f) => [f.id, f]));
	const tally: Record<string, Tally> = {};
	for (const finding of seen.values()) {
		const t = tally[finding.rule] ?? none;
		const counted = countedAs(finding, facts);
		tally[finding.rule] =
			counted === null ? {...t, open: t.open + 1} : {...t, [counted]: t[counted] + 1};
	}
	return tally;
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
