import type {SortAnswer, SortReply} from "./answer.ts";
import {barLines, leadOf} from "./bar.ts";
import type {SortContext, SortTicket} from "./services.ts";

// What the sorter is handed, and the Check its answer must pass. Both pure: the same ticket,
// context and repo note give the same text and the same problems.
//
// The brief is experiment 88's and 92's (experiments/lib/sort.ts), with the bar the direction note
// keeps, the open plans a report may be part of, and the rule a no names by id.
//
// Every try's prompt is whole: the brief, then what the Check found in the last answer. A try
// never leans on a conversation the agent kept: after a takeover the next host has none
// (experiment 104 found a plan's second try lost its first draft that way).

/** What the sorter is handed. */
export interface Brief {
	readonly ticket: SortTicket;
	readonly context: SortContext;
	/** What the repo is, in a few plain lines. */
	readonly note: string;
}

/** The meaning of each route, as experiment 88's brief states it. */
export const ROUTES = {
	plan: "something gets built or changed (code, docs, config, a workflow). The next step is to plan the work and hand it to a builder.",
	ruling:
		"an owner of the project must choose before anything is built: between options, on a direction, a name, a policy, a trade-off. A builder must not pick for them.",
	research:
		"nobody knows the answer yet and it has to be found out: measured, tried in a throwaway spike, or read out of the code or the docs. It ends in a finding, not a pull request.",
} as const;

/** A text in a code fence longer than any run of backticks inside it. */
const fenced = (text: string): string => {
	const longest = Math.max(2, ...[...text.matchAll(/`+/g)].map((run) => run[0].length));
	const fence = "`".repeat(longest + 1);
	return `${fence}markdown\n${text.replace(/\n+$/, "")}\n${fence}`;
};

const earlierLines = (brief: Brief): readonly string[] =>
	brief.context.earlier.length === 0
		? ["None."]
		: brief.context.earlier.map(
				(e) =>
					`#${e.number} (${e.state}) ${e.title}${e.reason === null ? "" : ` — closed by sort: ${e.reason}`}`,
			);

const planLines = (brief: Brief): readonly string[] =>
	brief.context.plans.length === 0
		? ["None."]
		: brief.context.plans.map(
				(p) =>
					`- plan #${p.number}${p.approved ? " (approved)" : ""}, covering ${p.tickets.map((t) => `#${t}`).join(", ")}: ${p.summary.replace(/\s+/g, " ").trim()}`,
			);

/** What the sorter is sent first. */
export function promptOf(brief: Brief): string {
	const t = brief.ticket;
	return [
		brief.note,
		"",
		"# What you answer",
		"",
		"First: is this ticket a duplicate of another one? A duplicate asks for the same change, or reports the same problem, as another ticket, open or closed. If it is, answer `duplicate` with that ticket's number as `of`. A closed ticket that sort said no to, with its reason, is a duplicate too: the reason says when it is worth bringing back.",
		"",
		"Otherwise: is it worth doing? Answer `yes` or `no`.",
		"",
		...barLines(),
		"",
		"A yes also says what the ticket needs next (`next`), one of:",
		`- \`plan\`: ${ROUTES.plan}`,
		`- \`ruling\`: ${ROUTES.ruling} Say what is asked (\`ask\`) and at least two \`options\`.`,
		`- \`research\`: ${ROUTES.research}`,
		"",
		"An open question the plan can carry with a lean is `plan`, not `ruling`.",
		"",
		"A yes that needs a plan may be part of an open plan below: when it adds to the work that plan already covers (a case it missed, a part of the same change), give that plan's number as `partOf`. A report that starts work of its own has `partOf: null`.",
		"",
		"`why` is one or two sentences on why you answered so.",
		"",
		`# The ticket: #${t.number}`,
		"",
		fenced(`# ${t.title}\n\n${t.body}`),
		"",
		"# The plans still open",
		"",
		...planLines(brief),
		"",
		"# The repo's other tickets, open or closed, newest first",
		"",
		...earlierLines(brief),
	].join("\n");
}

/** A later try: the whole brief again, then what the Check found in the last answer. */
export const promptFor = (brief: Brief, note: string | null): string =>
	note === null ? promptOf(brief) : `${promptOf(brief)}\n\n# Your last answer\n\n${note}`;

const oneLine = (text: string) => text.trim() !== "" && !text.trim().includes("\n");

/** What is wrong with an answer, as sentences the sorter can act on. None: it passes. Pure. */
export const sortProblems = (reply: SortReply, brief: Brief): readonly string[] => {
	const a: SortAnswer = reply.sort;
	const problems: string[] = [];
	if (a.why.trim() === "") problems.push("`why` is empty: say in a sentence why you answered so.");
	switch (a.answer) {
		case "duplicate": {
			if (a.of === brief.ticket.number)
				problems.push(`#${a.of} is this ticket itself: a duplicate names another ticket.`);
			else if (!brief.context.earlier.some((e) => e.number === a.of))
				problems.push(`#${a.of} is not one of the repo's tickets listed: name one that is.`);
			break;
		}
		case "no": {
			const lead = leadOf(a.rule);
			if (!oneLine(a.reason)) problems.push("`reason` must be one line.");
			else if (!a.reason.trim().toLowerCase().startsWith(lead.toLowerCase()))
				problems.push(`a no by \`${a.rule}\` starts its reason with "${lead}:".`);
			break;
		}
		case "yes": {
			if (a.next === "plan" && a.partOf !== null) {
				if (!brief.context.plans.some((p) => p.number === a.partOf))
					problems.push(
						`plan #${a.partOf} is not one of the open plans listed: name one that is, or give \`partOf: null\`.`,
					);
			}
			if (a.next === "ruling") {
				if (a.ask.trim() === "") problems.push("a ruling says what is asked in `ask`.");
				if (a.options.filter((o) => o.trim() !== "").length < 2)
					problems.push("a ruling gives at least two `options`.");
			}
			break;
		}
	}
	return problems;
};
