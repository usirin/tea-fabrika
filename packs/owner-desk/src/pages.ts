import {type AnswerBody, type Ask, titleOf} from "@kampus/pipeline/asks/ask";
import {
	type Changed,
	changedLines,
	type Line,
	linesOf,
	type Reworded,
} from "@kampus/pipeline/stages/plan/lines";

// What the desk shows, as data. A view (./markdown.ts, ./comment.ts) turns a
// page into text for one place; the pages are the same for every view.
//
//   inbox   everything waiting on the owner, oldest first
//   ask     one ask, with what the owner can answer:
//             a plan     its lines by section; a changed plan only what changed
//             a stuck    the task, its open count each round, its criteria
//             a ruling   the question, its options, why sort sent it
//   closed  an ask the core took an answer to, and what it said

/** One row of the inbox. */
export interface Row {
	readonly id: string;
	readonly for: Ask["for"];
	readonly title: string;
	/** Its place in the core's ledger: the smaller, the longer it has waited. */
	readonly at: number;
}

/** A plan's lines, by section, for one version: every line, or only what changed since the approved one. */
export type PlanBody =
	| {readonly whole: true; readonly sections: readonly Section[]}
	| {
			readonly whole: false;
			readonly approved: number;
			readonly added: readonly Line[];
			readonly removed: readonly Line[];
			/** Criteria kept under their ids, said otherwise. */
			readonly reworded: readonly Reworded[];
			readonly same: number;
	  };

export interface Section {
	readonly title: string;
	readonly lines: readonly Line[];
}

export type Page =
	| {readonly kind: "inbox"; readonly rows: readonly Row[]}
	| {
			readonly kind: "ask";
			readonly ask: Ask;
			/** Set for a plan only. */
			readonly plan: PlanBody | null;
			/** The core refused the owner's last answer to it, and why. */
			readonly refused: string | null;
	  }
	| {readonly kind: "closed"; readonly ask: Ask; readonly said: string};

/** The inbox page: every open ask, oldest first. Pure. */
export const inboxPage = (open: readonly Ask[]): Page => ({
	kind: "inbox",
	rows: [...open]
		.sort((a, b) => a.at - b.at)
		.map((ask) => ({id: ask.id, for: ask.for, title: titleOf(ask), at: ask.at})),
});

const SECTIONS: readonly {readonly title: string; readonly test: (key: string) => boolean}[] = [
	{title: "Summary", test: (key) => key === "summary"},
	{title: "User stories", test: (key) => /^s\d+$/.test(key)},
	{title: "Tasks and criteria", test: (key) => /^[tc]\d+$/.test(key)},
	{title: "Open questions, with the planner's lean", test: (key) => /^q\d+$/.test(key)},
	{title: "Pointers (they bind nobody)", test: (key) => /^p\d+$/.test(key)},
];

/** A plan ask's body: the whole plan the first time, and what changed since the approved version after. Pure. */
export function planBody(ask: Extract<Ask, {for: "plan"}>): PlanBody {
	if (ask.since !== null) {
		const changed: Changed = changedLines(ask.since.data, ask.data);
		return {whole: false, approved: ask.since.version, ...changed};
	}
	const lines = linesOf(ask.data);
	return {
		whole: true,
		sections: SECTIONS.map(({title, test}) => ({
			title,
			lines: lines.filter((line) => test(line.key)),
		})).filter((section) => section.lines.length > 0),
	};
}

/** The page for one ask. Pure. */
export const askPage = (ask: Ask, refused: string | null): Page => ({
	kind: "ask",
	ask,
	plan: ask.for === "plan" ? planBody(ask) : null,
	refused,
});

/** The answers an ask takes, as the owner types them on any view. */
export function answersFor(ask: Ask): readonly string[] {
	switch (ask.for) {
		case "plan":
			return ["/approve", "/change <line> <what it should say>", "/no <one-line reason>"];
		case "stuck":
			return [
				"/remove",
				"/keep-going <rounds, 1 to 10>",
				"/reword <criterion> When <trigger>, <result>",
			];
		case "ruling":
			return ["/rule lasting|one-off [build] <the answer>"];
		case "check":
			return ["/yes", "/no <what is wrong: it becomes a new criterion>"];
	}
}

/** Where an ask belongs: the ticket it is about. */
export const whereOf = (ask: Ask): string => (ask.for === "ruling" ? ask.ticket : ask.plan);

/** How an answer reads on a closed ask. Pure. */
export function saidOf(answer: AnswerBody): string {
	switch (answer.kind) {
		case "approve":
			return "approved";
		case "yes":
			return "yes";
		case "change":
			return `change ${answer.line}: ${answer.to}`;
		case "no":
			return `no: ${answer.why}`;
		case "remove":
			return "remove the task";
		case "keep_going":
			return `keep going, ${answer.rounds} rounds`;
		case "reword":
			return `reword ${answer.criterion}: When ${answer.when}, ${answer.result}`;
		case "rule":
			return `${answer.rule === "lasting" ? "a lasting rule" : "a one-off call"}${answer.build ? ", and it must be built" : ""}: ${answer.answer}`;
	}
}
