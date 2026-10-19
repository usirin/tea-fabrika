import {Schema} from "effect";

// The two texts a build writes where GitHub reads them: the commit message and
// the pull request's text. Each is kept as parts, not as one string, and made
// a string in one place here. GitHub closes a ticket from a closing word and a
// reference ("fixes #2") in either text, so which ticket a build closes is a
// part of its own (`closes`), written by code, and every word the builder
// handed back goes through `inert` on the way: its references link nowhere,
// so no closing word in it can reach a ticket.

/**
 * Zero-width space: invisible, and it breaks a reference GitHub would read.
 * Made from its code, so the source shows it.
 */
export const BREAK = String.fromCharCode(0x200b);

/**
 * A text of the builder's, with every reference GitHub would read broken:
 * `#2`, `owner/repo#2`, `GH-2`, and a ticket's or pull request's url. It reads
 * the same; it links to nothing and closes nothing.
 */
export const inert = (text: string): string =>
	text
		.replace(/#(?=\d)/g, `#${BREAK}`)
		.replace(/\b(gh)-(?=\d)/gi, `$1${BREAK}-`)
		.replace(/\/(issues|pull)\/(?=\d)/gi, `/$1${BREAK}/`);

/** The commit message, as parts. */
export const Commit = Schema.Struct({
	/** The ticket's title. */
	title: Schema.String,
	round: Schema.Finite,
	/** The builder's summary. */
	summary: Schema.String,
	/** The ticket, named without a closing word: the commit closes nothing. */
	refs: Schema.Finite,
});
export type Commit = typeof Commit.Type;

/** The pull request's text, as parts. */
export const PrBody = Schema.Struct({
	/** The one ticket the pull request closes: the one the build was asked for. */
	closes: Schema.Finite,
	round: Schema.Finite,
	/** The builder's words, from here down. */
	summary: Schema.String,
	deviations: Schema.Array(Schema.String),
	ran: Schema.Array(Schema.Struct({command: Schema.String, passed: Schema.Boolean})),
	left: Schema.Array(Schema.String),
});
export type PrBody = typeof PrBody.Type;

/** The commit message. */
export const messageText = (c: Commit): string =>
	`build: ${inert(c.title)} (round ${c.round})\n\n${inert(c.summary)}\n\nRefs #${c.refs}`;

const listOr = (items: readonly string[], none: string) =>
	items.length === 0
		? none
		: items.map((item) => `- ${inert(item).replace(/\s+/g, " ").trim()}`).join("\n");

/**
 * The pull request's text. `Closes #n` names the ticket the way the review
 * stage reads it, and `## Deviations` is the section it hands the reviewer:
 * "None." alone is the builder saying there are none.
 */
export const bodyText = (b: PrBody): string =>
	[
		`Closes #${b.closes}`,
		"",
		inert(b.summary),
		"",
		"## Deviations",
		"",
		listOr(b.deviations, "None."),
		"",
		"## Checked",
		"",
		listOr(
			b.ran.map((r) => `\`${r.command}\`: ${r.passed ? "passed" : "failed"}`),
			"Nothing was run.",
		),
		"",
		"## Left",
		"",
		listOr(b.left, "Nothing."),
		"",
		`Round ${b.round} of the tea-fabrika build loop. The builder had no network and no account; code committed, pushed and opened this.`,
	].join("\n");
