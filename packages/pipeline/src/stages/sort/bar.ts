// The bar for what is worth doing (docs/direction/sort-answers-yes-or-no.md, "The bar for a no"),
// as experiment 92 drafted it and the direction note keeps it: seven ways a ticket is a no, and four
// that look like a no but are a yes. Sort's brief states it; sort's answer names the rule it used by
// id, so a no that is not one of these seven does not read.
//
// Each no rule has the line its reason starts with. The Check holds a no's reason to it, so a reader
// sees at a glance which no it is ("not now", "won't do", "superseded", "duplicate"), and which ones
// are worth bringing back.

/** The seven ways a ticket is a no, in the direction note's order. */
export const NO_RULES = [
	{
		id: "already_fixed",
		rule: "The ticket asks for a fix or bump that a merged change on main already made. This often means it was filed from an old checkout or against an older pinned tool.",
		reason: "superseded: already fixed on main",
		needsCode: true,
		example: "the pinned pipeline tool lacked verbs, and a version bump already added every one",
	},
	{
		id: "target_removed",
		rule: "The ticket is about code, a feature or a page that has since been deleted, so there is nothing left to fix.",
		reason: "won't do: the thing this targets was removed",
		needsCode: true,
		example: "a bug in a viewer after the whole viewer was deleted",
	},
	{
		id: "carried",
		rule: "Another open ticket already carries the same work, or the same file in the same editing pass.",
		reason: "duplicate: folded into another ticket that carries this work",
		needsCode: false,
		example: "a doc import sweep that an earlier sweep ticket already covered",
	},
	{
		id: "replaced",
		rule: "The proposal was overtaken by a later design or umbrella ticket that answers the same question in a different way.",
		reason: "superseded: replaced by a later design",
		needsCode: false,
		example: "a per-function verdict idea dropped after a test run, replaced by a staged pipeline",
	},
	{
		id: "settled_no",
		rule: "The ticket asks again for something a decision record or an owner ruling already turned down, and brings no new fact.",
		reason: "won't do: already ruled out; reopen only with a new fact",
		needsCode: false,
		example: "an owner ruled to drop a wrapper layer and keep plain functions",
	},
	{
		id: "pipeline_tool",
		rule: "The bug is in the work-pipeline tool's own behavior, not in this repo's code, config or pinned version. It belongs in the tool's own repo. Only a pin bump or a config line is work here.",
		reason: "won't do here: a bug in the pipeline tool itself; file it in the tool's repo",
		needsCode: false,
		example: "a pipeline verb disagreeing with another verb, fixed upstream",
	},
	{
		id: "not_work",
		rule: "The ticket asks for no change. It is a standing readout, a placeholder or a tracking page.",
		reason: "won't do: not a work item",
		needsCode: false,
		example: "a standing readout issue that was never meant to be worked",
	},
] as const;

export type NoRule = (typeof NO_RULES)[number];
export type NoRuleId = NoRule["id"];
/** Every no rule's id, in the bar's order. A test holds it to `NO_RULES`. */
export const NO_RULE_IDS = [
	"already_fixed",
	"target_removed",
	"carried",
	"replaced",
	"settled_no",
	"pipeline_tool",
	"not_work",
] as const satisfies readonly NoRuleId[];

/** The four that look like a no and are a yes. */
export const STILL_YES = [
	{
		rule: "A ticket that only looks done or out of date stays a yes. It is done only when a merged change that closes it is found.",
		example: "every 'already done' close a backlog sweep proposed turned out wrong",
	},
	{
		rule: "The first time a host of a library asks it for something new is a yes, even if the library may not grow. The owner rules on it.",
		example: "skip saving short-lived states: no new API, shipped as a how-to page",
	},
	{
		rule: "Not now is not no. Right work that nobody needs yet stays open.",
		example: "a feature taken out of a campaign but left open",
	},
	{
		rule: "A gap one user found is still a yes when it is a basic thing every user needs, or a real bug or wrong doc in what a package ships.",
		example: "a store had no delete; ruled a storage basic, not one host's feature",
	},
] as const;

/** A no rule by its id. */
export const ruleOf = (id: NoRuleId): NoRule => NO_RULES.find((r) => r.id === id) as NoRule;

/** The words a no's reason starts with: the rule's reason up to its colon ("won't do", "superseded"). */
export const leadOf = (id: NoRuleId): string => {
	const reason = ruleOf(id).reason;
	return reason.slice(0, reason.indexOf(":"));
};

/** The bar as lines of sort's brief. Pure. */
export const barLines = (): readonly string[] => [
	"The repo's bar for what is worth doing. A ticket is a no when one of these holds. Name the rule by its id, and start the reason with the words shown:",
	...NO_RULES.map(
		(r) =>
			`- \`${r.id}\`: ${r.rule}${r.needsCode ? " Use it only when the ticket itself shows it." : ""} Reason: "${r.reason}". Example: ${r.example}.`,
	),
	"These are still a yes, even when they look like a no:",
	...STILL_YES.map((r) => `- ${r.rule} Example: ${r.example}.`),
	"When no rule above fits, the ticket is a yes.",
];
