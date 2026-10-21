import {Schema} from "effect";
import {NO_RULE_IDS} from "./bar.ts";

// Sort's answer, as the sorter writes it (docs/direction/sort-answers-yes-or-no.md). One of:
//
//   duplicate of N   the same change, or the same problem, as an earlier ticket, open or closed
//   no               one of the bar's seven rules, by id, with a one-line reason
//   yes              what the ticket needs next: a plan, the owner's ruling, or research
//
// A yes that needs a plan may name an open plan it is part of (`partOf`): the report becomes one
// more ticket of that plan (docs/direction/a-project-is-a-parent-plan.md). A yes that needs a ruling
// says what is asked and the options, so the owner's desk can show it. Each shape holds only what it
// needs: a no with no rule, a duplicate of nothing, or a ruling with no question cannot be written.

const Why = Schema.String.annotate({
	description: "One or two sentences on why this answer.",
});

export const Duplicate = Schema.Struct({
	answer: Schema.Literal("duplicate"),
	/** The earlier ticket's number. */
	of: Schema.Int,
	why: Why,
});
export const No = Schema.Struct({
	answer: Schema.Literal("no"),
	rule: Schema.Literals(NO_RULE_IDS),
	/** One line a reader can act on, starting with the rule's words. */
	reason: Schema.String,
	why: Why,
});
export const YesPlan = Schema.Struct({
	answer: Schema.Literal("yes"),
	next: Schema.Literal("plan"),
	/** The number of the open plan this report is part of, or null: it starts a plan of its own. */
	partOf: Schema.NullOr(Schema.Int),
	why: Why,
});
export const YesRuling = Schema.Struct({
	answer: Schema.Literal("yes"),
	next: Schema.Literal("ruling"),
	/** The question for the owner, in one or two sentences. */
	ask: Schema.String,
	options: Schema.Array(Schema.String),
	why: Why,
});
export const YesResearch = Schema.Struct({
	answer: Schema.Literal("yes"),
	next: Schema.Literal("research"),
	why: Why,
});

export const SortAnswer = Schema.Union([Duplicate, No, YesPlan, YesRuling, YesResearch]);
export type SortAnswer = typeof SortAnswer.Type;

/** What the sorter hands back: one object, as the Agent SDK takes a schema, holding the answer. */
export const SortReply = Schema.Struct({sort: SortAnswer});
export type SortReply = typeof SortReply.Type;

/** An answer in one word, as the tables read it: `duplicate`, `no`, `fold`, or the route of a yes. */
export type Said = "duplicate" | "no" | "fold" | "plan" | "ruling" | "research";
export const saidOf = (a: SortAnswer): Said => {
	if (a.answer !== "yes") return a.answer;
	if (a.next === "plan" && a.partOf !== null) return "fold";
	return a.next;
};
