import {Writer} from "@kampus/fabrika";
import {endedAs} from "@kampus/pipeline/stages/status";
import {Schema} from "effect";
import {prRefOf, words} from "./head.ts";
import type {Check, Entry, Fact} from "./ticket.ts";

// One short row per fact on a ticket's timeline (docs/direction/what-a-ticket-shows.md,
// section 2). A row is a view of its fact, and nothing reads it back:
//
//   {type: "ended", stage: "build", outcome: {kind: "send", to: "review", why: "built"}, usd: 0.41, turns: 14, ...}
//   // {text: "build: sent to review: built", more: "$0.41, 14 turns"}
//
// An outcome is spelled by the pipeline's `endedAs`, the same words `jobs` shows. Made on the host,
// in `shownOf`, so the window draws words and never the pipeline's code.

export const Row = Schema.Struct({
	/** The fact's place on the ledger: the row's key. */
	pos: Schema.Int,
	type: Schema.String,
	by: Writer,
	at: Schema.Finite,
	/** What happened, in a few words. */
	text: Schema.String,
	/** A second, quieter part: cost, counts, checks. "" when there is none. */
	more: Schema.String,
	/** Text a person or an agent wrote, shown under the row: a body, a comment, an answer's note. */
	body: Schema.NullOr(Schema.String),
});
export type Row = typeof Row.Type;

/** A count with its noun: `1 task`, `2 tasks`. */
const counted = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;

const FAILED: ReadonlySet<Check["conclusion"]> = new Set([
	"failure",
	"cancelled",
	"timed_out",
	"action_required",
	"stale",
]);

/** A pull request's checks in one line: failed (and which), running, or passed. */
export const checksLine = (checks: readonly Check[]): string => {
	if (checks.length === 0) return "no checks";
	const failed = checks.filter((c) => FAILED.has(c.conclusion)).map((c) => c.name);
	if (failed.length > 0) return `checks failed (${failed.join(", ")})`;
	if (checks.some((c) => c.status !== "completed")) return "checks running";
	return "checks passed";
};

const short = (sha: string) => sha.slice(0, 7);

type Said = Pick<Row, "text" | "more" | "body">;

const said = (text: string, more = "", body: string | null = null): Said => ({text, more, body});

/** A fact's words. `timeline`: the ticket's, for an answer to name what it answered. */
const saidOf = (fact: Fact, timeline: readonly Entry[]): Said => {
	switch (fact.type) {
		case "filed":
			return said("filed it", "", fact.body === "" ? null : fact.body);
		case "commented":
			return said("commented", "", fact.body);
		case "closed":
			return said("closed it");
		case "reopened":
			return said("reopened it");
		case "started":
			return said(
				fact.task === null ? `${fact.stage} started` : `${fact.stage} started, task ${fact.task}`,
			);
		case "ended":
			return said(
				`${fact.stage}: ${endedAs(fact.outcome, "done")}`,
				`$${fact.usd.toFixed(2)}, ${counted(fact.turns, "turn")}`,
			);
		case "planned":
			return said(`plan v${fact.version}`, counted(fact.tasks.length, "task"));
		case "pushed": {
			const last = fact.commits.at(-1);
			return said(
				counted(fact.commits.length, "commit"),
				last === undefined ? short(fact.head) : `${short(last.sha)} ${last.title}`,
			);
		}
		case "reviewed":
			return said(
				`review at ${short(fact.head)}: ${fact.met} of ${fact.of} met`,
				counted(fact.findings.length, "finding"),
			);
		case "pr":
			return said(`PR ${prRefOf(fact.url)} ${fact.state}`, checksLine(fact.checks));
		case "asked":
			return said(`asks you: ${fact.what}`, fact.picks.join(" / "));
		case "answered": {
			const asked = timeline.find((e) => e.fact.type === "asked" && e.fact.ask === fact.ask);
			const what = asked?.fact.type === "asked" ? asked.fact.what : fact.ask;
			return said(`answered "${what}": ${fact.pick}`, "", fact.note === "" ? null : fact.note);
		}
		case "rated":
			return said(`rated finding ${fact.finding}: ${words(fact.says)}`);
	}
};

/** One entry's row. */
export const rowOf = (entry: Entry, timeline: readonly Entry[]): Row => ({
	pos: entry.pos,
	type: entry.fact.type,
	by: entry.by,
	at: entry.at,
	...saidOf(entry.fact, timeline),
});

/** Every row of a timeline, oldest first. */
export const rowsOf = (timeline: readonly Entry[]): readonly Row[] =>
	timeline.map((e) => rowOf(e, timeline));
